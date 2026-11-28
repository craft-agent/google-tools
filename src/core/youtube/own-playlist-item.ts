import { createHash } from "node:crypto"
import { z } from "zod"
import { ToolError } from "../errors"
import { canonicalJson } from "../pin"
import { shown } from "../run/ids"
import { parseReply } from "../sheets/reply"
import { youtubeError } from "./errors"
import type { OwnSession } from "./own-calls"
import { YOUTUBE_ROUTES } from "./routes"

/** The parts of an entry the writes read: its playlist, video, position and title, and its note. */
const ITEM_PARTS = "snippet,contentDetails"

/** The kind a playlist entry's resource names for a video. */
const VIDEO_KIND = "youtube#video"

/** An entry of a playlist as `playlistItems.list` gives it with the parts `snippet` and `contentDetails`; every field not read here is left out of the parse. */
export const itemStateReply = z.object({
  id: z.string(),
  snippet: z
    .object({
      playlistId: z.string().optional(),
      position: z.number().optional(),
      title: z.string().optional(),
      resourceId: z.object({ videoId: z.string().optional() }).optional(),
    })
    .optional(),
  contentDetails: z.object({ videoId: z.string().optional(), note: z.string().optional() }).optional(),
})

const itemsStateList = z.object({ items: z.array(itemStateReply).optional() })

/** An entry of a playlist as the writes work with it: what an update sends back, as Google gave it, and the video's title as the entry gives it. */
export type PlaylistItemState = {
  id: string
  playlistId: string
  videoId: string
  /** `null` when Google gave none. */
  position: number | null
  /** `undefined` for an entry without a note. */
  note: string | undefined
  title: string
}

/** The resource a playlist entry names a video by. */
export function videoResourceId(videoId: string): { kind: string; videoId: string } {
  return { kind: VIDEO_KIND, videoId }
}

/**
 * The entry `item` of the playlist `playlist`, as `playlistItems.list` gives
 * it: one Google does not return, or one of another playlist, is `not_found`.
 * The playlist is the caller's to have checked as the channel's own. Google's
 * failures come out as `youtubeError` makes them.
 */
export async function ownPlaylistItem(session: OwnSession, playlist: string, item: string): Promise<PlaylistItemState> {
  const found = await readFromGoogle(session, item)
  if (found === undefined || found.snippet?.playlistId !== playlist) {
    throw new ToolError(
      "not_found",
      `Playlist item ${shown(item)} is not an entry of playlist ${playlist}, or the account cannot see it.`,
    )
  }
  const videoId = found.snippet.resourceId?.videoId ?? found.contentDetails?.videoId
  if (videoId === undefined) {
    throw new ToolError("upstream_error", "Google's reply to the playlist item list was not in the expected shape.")
  }
  return {
    id: item,
    playlistId: playlist,
    videoId,
    position: found.snippet.position ?? null,
    note: found.contentDetails?.note,
    title: found.snippet.title ?? "",
  }
}

/** The digest of an entry as it was read, which the prompt pins: an entry changed after the prompt gives another one, so the call is `stale`. */
export function itemPin(item: PlaylistItemState): string {
  return createHash("sha256").update(canonicalJson(item)).digest("hex")
}

/** The entry `id` as `playlistItems.list` gives it, if it does. */
async function readFromGoogle(session: OwnSession, id: string) {
  try {
    const reply = await session.client.request(YOUTUBE_ROUTES.playlistItems, { query: { part: ITEM_PARTS, id } })
    return parseReply(itemsStateList, reply, "the playlist item list").items?.find((entry) => entry.id === id)
  } catch (error) {
    throw youtubeError(error)
  }
}
