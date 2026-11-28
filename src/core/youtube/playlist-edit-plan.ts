import type { GoogleSession } from "../google/session"
import type { ToolContext } from "../tool"
import { checkedLanguage, checkedPlaylistDescription, checkedPlaylistTitle, refusal } from "./checks"
import { playlistId } from "./ids"
import { checkLocalizations } from "./localizations"
import { ownPlaylist } from "./own-playlist"
import type { YoutubePlaylistEditArgs } from "./playlist-args"
import {
  PLAYLIST_EDIT_PARTS,
  changedFields,
  mergedPlaylist,
  type PlaylistEditPart,
  type PlaylistFieldChange,
} from "./playlist-edit-merge"
import type { PlaylistState } from "./playlist-state"
import { YOUTUBE_ROUTES } from "./routes"
import { youtubeWriteSession } from "./write-session"

/** A playlist edit planned: the playlist as it was and as it will be, the fields that change and what is sent. */
export type PlaylistEditPlan = {
  session: GoogleSession
  playlist: string
  /** The playlist as it was read. */
  before: PlaylistState
  /** The playlist as the edit leaves it, which is what is sent of the parts the edit touches. */
  after: PlaylistState
  changes: PlaylistFieldChange[]
  /** The parts sent, in the order `part` lists them. */
  parts: PlaylistEditPart[]
  /** The body of the update: the playlist's id and each part sent, whole. */
  body: Record<string, unknown>
}

/** The body of the update: the playlist's id and each part the edit touches, whole. */
function bodyOf(after: PlaylistState, parts: readonly PlaylistEditPart[]): Record<string, unknown> {
  return {
    id: after.id,
    ...(parts.includes("snippet") && { snippet: after.snippet }),
    ...(parts.includes("localizations") && { localizations: after.localizations }),
  }
}

/** Refuses, before anything is read or sent, an edit that changes nothing, sets and removes the same language, or holds a value outside Google's limits. */
function checkPlaylistEdit(args: YoutubePlaylistEditArgs): void {
  const { account: _account, playlist: _playlist, ...changes } = args
  if (Object.values(changes).every((value) => value === undefined)) {
    throw refusal("Give at least one thing to change")
  }
  if (args.title !== undefined) checkedPlaylistTitle(args.title)
  if (args.description !== undefined) checkedPlaylistDescription(args.description)
  if (args.default_language !== undefined) checkedLanguage(args.default_language, "`default_language`")
  checkLocalizations(args, { title: checkedPlaylistTitle, description: checkedPlaylistDescription })
}

/**
 * Checks the arguments and the label's scopes before anything is read, then
 * reads the label's channel and the playlist, which must be the channel's own,
 * and plans the update: the changes, and the parts they touch, sent whole as
 * read with the changes applied. An edit that leaves every value as it is is
 * `invalid_argument`.
 */
export async function planPlaylistEdit(args: YoutubePlaylistEditArgs, ctx: ToolContext): Promise<PlaylistEditPlan> {
  const playlist = playlistId(args.playlist)
  checkPlaylistEdit(args)
  const session = await youtubeWriteSession(ctx, args.account, YOUTUBE_ROUTES.playlistsUpdate)
  const { state } = await ownPlaylist(session, playlist)
  const after = mergedPlaylist(state, args)
  const changes = changedFields(state, after, args)
  if (changes.length === 0) throw refusal("The playlist already has these values")
  const parts = PLAYLIST_EDIT_PARTS.filter((part) => changes.some((change) => change.part === part))
  return { session, playlist, before: state, after, changes, parts, body: bodyOf(after, parts) }
}
