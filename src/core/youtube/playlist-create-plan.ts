import type { GoogleSession } from "../google/session"
import type { ToolContext } from "../tool"
import { checkedLanguage, checkedPlaylistDescription, checkedPlaylistTitle, refusal } from "./checks"
import { youtubeError } from "./errors"
import { MAX_LOCALIZATIONS } from "./localizations"
import { ownChannel } from "./own-calls"
import type { YoutubePlaylistCreateArgs } from "./playlist-args"
import { YOUTUBE_ROUTES } from "./routes"
import { youtubeWriteSession } from "./write-session"

/** The privacy every new playlist names: changing who can watch it is `google_youtube_privacy_set`'s. */
export const NEW_PLAYLIST_PRIVACY = "private"

/** A playlist to make, its arguments checked: what the prompt shows of it and the request that makes it. */
export type PlaylistCreateAsk = {
  title: string
  description: string | undefined
  /** The parts sent, in the order `part` lists them. */
  parts: string
  /** The body of the insert: the snippet, the status (always private) and the localizations when there are any. */
  body: Record<string, unknown>
}

/** A playlist made planned: the ask and the label's channel it is made in. */
export type PlaylistCreatePlan = PlaylistCreateAsk & {
  session: GoogleSession
  /** The id of the label's channel, which the playlist is made in. */
  channel: string
}

/** The localizations `args` give, each checked: a language tag, a title and a description within Google's limits, at most 50, and a default language for them. */
function checkedLocalizations(
  args: YoutubePlaylistCreateArgs,
): NonNullable<YoutubePlaylistCreateArgs["localizations"]> {
  const localizations = args.localizations ?? {}
  const languages = Object.keys(localizations)
  if (languages.length > MAX_LOCALIZATIONS) {
    throw refusal(`\`localizations\` names ${languages.length} languages, at most ${MAX_LOCALIZATIONS} are allowed`)
  }
  if (languages.length > 0 && args.default_language === undefined) {
    throw refusal("Localizations need the playlist's default language; give `default_language`")
  }
  for (const [language, { title, description }] of Object.entries(localizations)) {
    checkedLanguage(language, "A `localizations` language")
    checkedPlaylistTitle(title, `The title of the \`${language}\` localization`)
    if (description !== undefined) {
      checkedPlaylistDescription(description, `The description of the \`${language}\` localization`)
    }
  }
  return localizations
}

/** The playlist `args` ask for, each limit of Google checked: the status is always `private`, and the localizations are sent when there are any. */
export function checkedPlaylistCreate(args: YoutubePlaylistCreateArgs): PlaylistCreateAsk {
  const localizations = checkedLocalizations(args)
  const snippet = {
    title: checkedPlaylistTitle(args.title),
    ...(args.description !== undefined && { description: checkedPlaylistDescription(args.description) }),
    ...(args.default_language !== undefined && {
      defaultLanguage: checkedLanguage(args.default_language, "`default_language`"),
    }),
  }
  const localized = Object.keys(localizations).length > 0
  return {
    title: args.title,
    description: args.description,
    parts: localized ? "snippet,status,localizations" : "snippet,status",
    body: { snippet, status: { privacyStatus: NEW_PLAYLIST_PRIVACY }, ...(localized && { localizations }) },
  }
}

/**
 * Checks the arguments (every limit of Google) and the label's scopes before
 * anything is read, then reads the label's channel, which the playlist is made
 * in; an account with no channel is `not_found`. Any failure here fails the
 * call before anything is created.
 */
export async function planPlaylistCreate(
  args: YoutubePlaylistCreateArgs,
  ctx: ToolContext,
): Promise<PlaylistCreatePlan> {
  const ask = checkedPlaylistCreate(args)
  const session = await youtubeWriteSession(ctx, args.account, YOUTUBE_ROUTES.playlistsInsert)
  try {
    return { ...ask, session, channel: (await ownChannel(session, "id")).id }
  } catch (error) {
    throw youtubeError(error)
  }
}
