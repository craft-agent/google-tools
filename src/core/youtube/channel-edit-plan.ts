import type { GoogleSession } from "../google/session"
import { shown } from "../run/ids"
import type { ToolContext } from "../tool"
import type { YoutubeChannelEditArgs } from "./channel-edit-args"
import { changedFields, mergedChannel, type ChannelFieldChange } from "./channel-edit-merge"
import { CHANNEL_STATE_PARTS, channelState, type ChannelState } from "./channel-state"
import { checkedChannelDescription, checkedCountry, checkedKeywords, checkedLanguage, refusal } from "./checks"
import { youtubeError } from "./errors"
import { videoId } from "./ids"
import { ownChannel } from "./own-calls"
import { ownVideo } from "./own-video"
import { YOUTUBE_ROUTES } from "./routes"
import { youtubeWriteSession } from "./write-session"

/** A channel edit planned: the channel as it was and as it will be, and the fields that change. */
export type ChannelEditPlan = {
  session: GoogleSession
  /** The channel as it was read. */
  before: ChannelState
  /** The channel as the edit leaves it, whose branding settings are what is sent. */
  after: ChannelState
  changes: ChannelFieldChange[]
}

/** The keyword both added and removed, if any. */
const contradiction = (added: readonly string[], removed: readonly string[]) =>
  added.find((keyword) => removed.includes(keyword))

/**
 * Refuses, before anything is read or sent, an edit that changes nothing,
 * adds and removes the same keyword, or holds a value outside Google's
 * limits.
 */
export function checkChannelEdit(args: YoutubeChannelEditArgs): void {
  const { account: _account, ...changes } = args
  if (Object.values(changes).every((value) => value === undefined)) {
    throw refusal("Give at least one thing to change")
  }
  if (args.description !== undefined) checkedChannelDescription(args.description)
  if (args.add_keywords !== undefined) checkedKeywords(args.add_keywords, "`add_keywords`")
  if (args.remove_keywords !== undefined) checkedKeywords(args.remove_keywords, "`remove_keywords`")
  const both = contradiction(args.add_keywords ?? [], args.remove_keywords ?? [])
  if (both !== undefined) throw refusal(`The keyword ${shown(both)} is both added and removed`)
  if (args.country !== undefined) checkedCountry(args.country)
  if (args.default_language !== undefined) checkedLanguage(args.default_language, "`default_language`")
  if (args.trailer !== undefined && args.trailer !== "") videoId(args.trailer)
}

/** The label's channel as the edit works with it, Google's failures as `youtubeError` makes them. */
async function readChannel(session: GoogleSession): Promise<ChannelState> {
  try {
    return channelState(await ownChannel(session, CHANNEL_STATE_PARTS))
  } catch (error) {
    throw youtubeError(error)
  }
}

/** The id of the video the edit makes the trailer, which must be one of the channel's own; `""` for none, `undefined` when the edit leaves the trailer. */
async function trailerOf(session: GoogleSession, trailer: string | undefined): Promise<string | undefined> {
  if (trailer === undefined || trailer === "") return trailer
  const video = videoId(trailer)
  await ownVideo(session, video)
  return video
}

/**
 * Checks the arguments and the label's scopes before anything is read, then
 * reads the label's channel (an account with no channel is `not_found`) and
 * the trailer, which must be one of the channel's own videos, and plans the
 * update: the changes, and the branding settings sent whole as read with the
 * changes applied. An edit that leaves every value as it is is
 * `invalid_argument`.
 */
export async function planChannelEdit(args: YoutubeChannelEditArgs, ctx: ToolContext): Promise<ChannelEditPlan> {
  checkChannelEdit(args)
  const session = await youtubeWriteSession(ctx, args.account, YOUTUBE_ROUTES.channelsUpdate)
  const before = await readChannel(session)
  const after = mergedChannel(before, args, await trailerOf(session, args.trailer))
  const changes = changedFields(before, after, args)
  if (changes.length === 0) throw refusal("The channel already has these values")
  return { session, before, after, changes }
}
