import { z } from "zod"
import { accountArg } from "../sheets/schemas"
import { analyticsRowSchema } from "./analytics-view"
import { captionSchema } from "./caption-view"
import { channelSchema } from "./channel-view"
import { commentSchema } from "./comment-view"
import { myChannelSchema } from "./my-channel-view"
import { ownVideoSchema } from "./my-videos-view"
import { LIMITS, MAX_LIMIT } from "./paging"
import { playlistItemSchema, playlistSchema } from "./playlist-view"
import { SEARCH_KINDS, searchResultSchema } from "./search-view"

/** The methods of the YouTube read. */
export const YOUTUBE_METHODS = [
  "search",
  "videos",
  "channels",
  "playlist",
  "comments",
  "my_channel",
  "my_videos",
  "captions",
  "analytics",
] as const

/** How many days before its `end` a report starts when `start` is left out. */
export const DEFAULT_ANALYTICS_WINDOW_DAYS = 27

/** The metrics of a report that names none. */
export const DEFAULT_ANALYTICS_METRICS =
  "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,comments,shares"

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
    .describe(
      `videos: 1 to ${MAX_LOOKUPS} video ids or video addresses; a repeated one counts once. analytics: only these videos (adds \`video==…\` to \`filters\`).`,
    ),
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
    .describe(
      "comments: the video whose comment threads to list, an id or an address; never with `thread`. captions: the channel's own video whose caption tracks to list.",
    ),
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
    .describe(
      `search, playlist, comments, my_videos, analytics: how many to return (${limitHelp}); analytics: rows, and only for a report with dimensions other than \`day\` or \`month\`.`,
    ),
  page_token: z
    .string()
    .min(1)
    .optional()
    .describe("search, playlist, comments, my_videos: the `next_page_token` of the previous call, for the next page."),
  metrics: z
    .string()
    .optional()
    .describe(
      `analytics: comma-separated metric names (default \`${DEFAULT_ANALYTICS_METRICS}\`); letters only, such as \`views,likes\`.`,
    ),
  dimensions: z
    .string()
    .optional()
    .describe(
      "analytics: comma-separated dimension names that group the rows, such as `day`, `video` or `country`; none gives one row of totals.",
    ),
  filters: z
    .string()
    .optional()
    .describe(
      "analytics: `name==value` pairs joined by `;`, such as `country==JP;video==ID1,ID2` (a value may be several, comma-separated).",
    ),
  sort: z
    .string()
    .optional()
    .describe(
      "analytics: comma-separated metric names to order the rows by, `-` in front for descending; with the dimension `video` and no `sort`, by the first metric, descending.",
    ),
  start: z
    .string()
    .optional()
    .describe(
      `analytics: the first day of the report, YYYY-MM-DD; default ${DEFAULT_ANALYTICS_WINDOW_DAYS} days before \`end\`; not after \`end\`.`,
    ),
  end: z.string().optional().describe("analytics: the last day of the report, YYYY-MM-DD; default today (UTC)."),
})

/** One object for all methods, each filling its own keys; a list fills its list key and `next_page_token`. */
export const youtubeReadOutput = z
  .object({
    results: z.array(searchResultSchema),
    /** Google's estimate of everything the search matches. */
    total_results: z.number().nullable(),
    videos: z.array(ownVideoSchema),
    channels: z.array(channelSchema),
    /** The videos or channels asked for that Google did not return, as given (videos: by id). */
    not_found: z.array(z.string()),
    playlist: playlistSchema,
    items: z.array(playlistItemSchema),
    comments: z.array(commentSchema),
    /** The label's own channel (`my_channel`). */
    channel: myChannelSchema,
    /** The label's channel (`my_videos`). */
    channel_id: z.string(),
    /** The video whose caption tracks `captions` lists. */
    video_id: z.string(),
    tracks: z.array(captionSchema),
    /** The days a report covers, YYYY-MM-DD, and its columns and rows. */
    start: z.string(),
    end: z.string(),
    columns: z.array(z.string()),
    rows: z.array(analyticsRowSchema),
    /** The title of each video a report's `video` column names; `null` without such a column. */
    titles: z.record(z.string(), z.string()).nullable(),
    /** What to know when reading a report. */
    note: z.string(),
    next_page_token: z.string().nullable(),
  })
  .partial()

export type YoutubeReadArgs = z.output<typeof youtubeReadInput>
export type YoutubeMethod = (typeof YOUTUBE_METHODS)[number]
export type YoutubeReadResult = z.input<typeof youtubeReadOutput>
