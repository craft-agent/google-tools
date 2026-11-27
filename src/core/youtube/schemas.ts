import { z } from "zod"
import { accountArg } from "../sheets/schemas"
import { channelSchema } from "./channel-view"
import { commentSchema } from "./comment-view"
import { LIMITS, MAX_LIMIT } from "./paging"
import { playlistItemSchema, playlistSchema } from "./playlist-view"
import { SEARCH_KINDS, searchResultSchema } from "./search-view"
import { videoSchema } from "./video-view"

/** The methods of the YouTube read. */
export const YOUTUBE_METHODS = ["search", "videos", "channels", "playlist", "comments"] as const

/** How `search` orders its results, and how `comments` orders the threads of a video. */
export const SEARCH_ORDERS = ["relevance", "date", "view_count", "rating", "title"] as const
export const COMMENT_ORDERS = ["relevance", "time"] as const

/** How long the videos `search` finds are. */
export const SEARCH_DURATIONS = ["short", "medium", "long"] as const

/** The most characters of a search's `query` and of a comment search's `search_terms`, once whitespace is collapsed. */
export const MAX_QUERY_CHARACTERS = 200

/** The most videos or channels one call looks up: what Google takes in one list call. */
export const MAX_LOOKUPS = 50

const limitHelp = Object.entries(LIMITS)
  .map(([method, { standard, max }]) => `${method} 1 to ${max}, default ${standard}`)
  .join("; ")

export const youtubeReadInput = z.strictObject({
  method: z.enum(YOUTUBE_METHODS),
  account: accountArg,
  query: z
    .string()
    .optional()
    .describe(
      `search: the words to search for (at most ${MAX_QUERY_CHARACTERS} characters once whitespace is collapsed); at least one of \`query\` and \`channel\`.`,
    ),
  channel: z
    .string()
    .optional()
    .describe(
      "search: only what this channel holds, a `UC…` id, an `@handle` or a channel address; a handle costs one more call, to find its channel.",
    ),
  kind: z.enum(SEARCH_KINDS).optional().describe("search: what to find: `video` (default), `channel` or `playlist`."),
  order: z
    .enum([...SEARCH_ORDERS, "time"] as const)
    .optional()
    .describe(
      `search: ${SEARCH_ORDERS.map((order) => `\`${order}\``).join(", ")} (default \`relevance\`); comments, with \`video\`: ${COMMENT_ORDERS.map((order) => `\`${order}\``).join(" or ")} (default \`relevance\`).`,
    ),
  published_after: z
    .string()
    .optional()
    .describe("search: only what was published on or after this day, as YYYY-MM-DD (midnight UTC)."),
  published_before: z
    .string()
    .optional()
    .describe(
      "search: only what was published before this day, as YYYY-MM-DD (midnight UTC); not before `published_after`.",
    ),
  duration: z
    .enum(SEARCH_DURATIONS)
    .optional()
    .describe("search, kind `video` only: `short` (under 4 minutes), `medium` (4 to 20) or `long` (over 20)."),
  language: z.string().optional().describe("search: favour results in this language, such as `ja` or `zh-Hans`."),
  region: z
    .string()
    .optional()
    .describe("search: favour results viewable in this country, its two-letter code such as `JP`."),
  videos: z
    .array(z.string())
    .min(1)
    .max(MAX_LOOKUPS)
    .optional()
    .describe(`videos: 1 to ${MAX_LOOKUPS} video ids or video addresses; a repeated one counts once.`),
  channels: z
    .array(z.string())
    .min(1)
    .max(MAX_LOOKUPS)
    .optional()
    .describe(
      `channels: 1 to ${MAX_LOOKUPS} \`UC…\` ids, \`@handles\` or channel addresses; the ids go in one call, each handle takes its own.`,
    ),
  playlist: z.string().optional().describe("playlist: the playlist's id, or an address with `list=`."),
  video: z
    .string()
    .optional()
    .describe("comments: the video whose comment threads to list, an id or an address; never with `thread`."),
  thread: z
    .string()
    .optional()
    .describe(
      "comments: the `comment_id` of a thread, whose replies to list; never with `video`, `order` or `search_terms`.",
    ),
  search_terms: z
    .string()
    .optional()
    .describe(
      `comments, with \`video\`: only the threads whose text holds these words (at most ${MAX_QUERY_CHARACTERS} characters once whitespace is collapsed).`,
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .optional()
    .describe(`search, playlist, comments: how many to return (${limitHelp}).`),
  page_token: z
    .string()
    .min(1)
    .optional()
    .describe("search, playlist, comments: the `next_page_token` of the previous call, for the next page."),
})

/** One object for all methods, each filling its own keys; a list fills its list key and `next_page_token`. */
export const youtubeReadOutput = z
  .object({
    results: z.array(searchResultSchema),
    /** Google's estimate of everything the search matches. */
    total_results: z.number().nullable(),
    videos: z.array(videoSchema),
    channels: z.array(channelSchema),
    /** The videos or channels asked for that Google did not return, as given (videos: by id). */
    not_found: z.array(z.string()),
    playlist: playlistSchema,
    items: z.array(playlistItemSchema),
    comments: z.array(commentSchema),
    next_page_token: z.string().nullable(),
  })
  .partial()

export type YoutubeReadArgs = z.output<typeof youtubeReadInput>
export type YoutubeMethod = (typeof YOUTUBE_METHODS)[number]
export type YoutubeReadResult = z.input<typeof youtubeReadOutput>
