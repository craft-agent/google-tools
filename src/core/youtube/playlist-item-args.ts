import { z } from "zod"
import { accountArg } from "../sheets/schemas"
import { MAX_PLAYLIST_NOTE_CHARACTERS } from "./checks"
import { playlistArg } from "./write-args"

/** What a removal says it did and did not do. */
export const REMOVED_NOTE = "Only the entry was removed; the video itself is unchanged."

const itemArg = z
  .string()
  .describe(
    "The entry to change: its `playlist_item_id`, as `google_youtube_read` method `playlist` gives it (not the video's id). It must be an entry of `playlist`.",
  )

const positionArg = z.number().int().min(0)

export const youtubePlaylistAddInput = z.strictObject({
  account: accountArg,
  playlist: playlistArg,
  video: z
    .string()
    .describe(
      "The video to add: its id, or its YouTube address (https://www.youtube.com/watch?v=<id>). It may be any video the account can see, not only the channel's own.",
    ),
  position: positionArg
    .optional()
    .describe(
      "Where in the playlist to put it, a whole number from 0 (the first place). Default: the end. Only a playlist sorted by hand takes a position.",
    ),
  note: z
    .string()
    .optional()
    .describe(
      `A note on the entry, at most ${MAX_PLAYLIST_NOTE_CHARACTERS} characters; people who watch the playlist see it.`,
    ),
})

export const youtubePlaylistAddOutput = z.object({
  playlist_item_id: z
    .string()
    .describe("The new entry's id, which `google_youtube_playlist_move` and `google_youtube_playlist_remove` take."),
  playlist_id: z.string(),
  video_id: z.string(),
  position: z.number().nullable().describe("Where the entry is, as Google reports it; null when it says none."),
})

export const youtubePlaylistMoveInput = z.strictObject({
  account: accountArg,
  playlist: playlistArg,
  item: itemArg,
  position: positionArg.describe(
    "Where to put the entry, a whole number from 0 (the first place). Only a playlist sorted by hand takes a position.",
  ),
})

const positionState = z.object({
  position: z.number().nullable().describe("The entry's position; null when Google says none."),
})

export const youtubePlaylistMoveOutput = z.object({
  playlist_item_id: z.string(),
  playlist_id: z.string(),
  video_id: z.string(),
  before: positionState.describe("Where the entry was."),
  after: positionState.describe("Where Google reports the entry now."),
})

export const youtubePlaylistRemoveInput = z.strictObject({
  account: accountArg,
  playlist: playlistArg,
  item: itemArg,
})

export const youtubePlaylistRemoveOutput = z.object({
  playlist_item_id: z.string(),
  playlist_id: z.string(),
  video_id: z.string(),
  position: z.number().nullable().describe("Where the entry was; null when Google said none."),
  note: z.string().describe("What was and was not removed."),
})

export type YoutubePlaylistAddArgs = z.output<typeof youtubePlaylistAddInput>
export type YoutubePlaylistAddResult = z.input<typeof youtubePlaylistAddOutput>
export type YoutubePlaylistMoveArgs = z.output<typeof youtubePlaylistMoveInput>
export type YoutubePlaylistMoveResult = z.input<typeof youtubePlaylistMoveOutput>
export type YoutubePlaylistRemoveArgs = z.output<typeof youtubePlaylistRemoveInput>
export type YoutubePlaylistRemoveResult = z.input<typeof youtubePlaylistRemoveOutput>
