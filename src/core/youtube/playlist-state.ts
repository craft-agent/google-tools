import { createHash } from "node:crypto"
import { z } from "zod"
import { ToolError } from "../errors"
import { canonicalJson } from "../pin"
import { localizationReply, type Localization } from "./video-state"

/** The parts of a playlist the writes read: `playlists.update` takes the snippet and the localizations whole, and the status and the entry count are what the prompt shows. */
export const PLAYLIST_STATE_PARTS = "snippet,status,localizations,contentDetails"

/**
 * A playlist as `playlists.list` and `playlists.update` give it with the parts
 * `snippet`, `status`, `localizations` and `contentDetails`. Only the writable
 * properties are kept (and the snippet's `channelId`, which says whose the
 * playlist is, and the entry count), since an update sends back exactly those;
 * every other field is left out of the parse.
 */
export const playlistStateReply = z.object({
  id: z.string(),
  snippet: z
    .object({
      channelId: z.string().optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      defaultLanguage: z.string().optional(),
    })
    .optional(),
  status: z.object({ privacyStatus: z.string().optional(), podcastStatus: z.string().optional() }).optional(),
  localizations: z.record(z.string(), localizationReply).optional(),
  contentDetails: z.object({ itemCount: z.number().optional() }).optional(),
})

export const playlistsStateList = z.object({ items: z.array(playlistStateReply).optional() })

export type PlaylistStateReply = z.output<typeof playlistStateReply>

/** The writable properties of a playlist's `snippet`. */
export type PlaylistSnippet = {
  title: string
  description: string
  defaultLanguage?: string
}

/** The writable properties of a playlist's `status`: who can watch it, and whether it is a podcast (`enabled`, `disabled` or `unspecified`). */
export type PlaylistStatus = {
  privacyStatus: string
  podcastStatus?: string
}

/** A playlist as the writes work with it: the writable properties an update sends back, as Google gave them, and how many entries it holds. */
export type PlaylistState = {
  id: string
  snippet: PlaylistSnippet
  status: PlaylistStatus
  localizations: Record<string, Localization>
  /** `null` when Google gave none. */
  itemCount: number | null
}

/** The playlist `reply` holds as a state; one without a title or a privacy is not the shape the writes rely on, `upstream_error`. */
export function playlistState(reply: PlaylistStateReply): PlaylistState {
  const { snippet, status } = reply
  if (snippet?.title === undefined || status?.privacyStatus === undefined) {
    throw new ToolError("upstream_error", "Google's reply to the playlist list was not in the expected shape.")
  }
  const { channelId: _channelId, ...writable } = snippet
  return {
    id: reply.id,
    snippet: { ...writable, title: snippet.title, description: snippet.description ?? "" },
    status: { ...status, privacyStatus: status.privacyStatus },
    localizations: reply.localizations ?? {},
    itemCount: reply.contentDetails?.itemCount ?? null,
  }
}

/** `state` with what Google's update `reply` reports laid over it: a part or a property the reply leaves out keeps its value. */
export function withPlaylistReply(state: PlaylistState, reply: PlaylistStateReply): PlaylistState {
  const { channelId: _channelId, ...snippet } = reply.snippet ?? {}
  return {
    ...state,
    snippet: { ...state.snippet, ...snippet },
    status: { ...state.status, ...reply.status },
    localizations: reply.localizations ?? state.localizations,
  }
}

/**
 * The digest of the writable properties of every part the writes read, which
 * the prompt pins: a playlist changed after the prompt gives another one, so
 * the call is `stale`. The entry count is not in it: it changes with every
 * entry anyone adds or takes out, which is no change to the playlist's own.
 */
export function playlistPin({ snippet, status, localizations }: PlaylistState): string {
  return createHash("sha256").update(canonicalJson({ snippet, status, localizations })).digest("hex")
}
