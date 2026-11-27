import { ToolError } from "../errors"
import { channelRef, commentId, videoId, type ChannelRef } from "./ids"
import { pageOf, type Page } from "./paging"
import type { SearchKind } from "./search-view"
import { COMMENT_ORDERS, MAX_QUERY_CHARACTERS, SEARCH_ORDERS, type YoutubeReadArgs } from "./schemas"

/** How Google names each order of a search. */
const SEARCH_ORDER_NAMES = {
  relevance: "relevance",
  date: "date",
  view_count: "viewCount",
  rating: "rating",
  title: "title",
} as const satisfies Record<(typeof SEARCH_ORDERS)[number], string>

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** A language code as `relevanceLanguage` takes it: `ja`, `zh-Hans`. */
const LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/

const REGION_PATTERN = /^[A-Za-z]{2}$/

/** What a search asks Google for, every argument checked. */
export type SearchRequest = {
  query: string | undefined
  channel: ChannelRef | undefined
  kind: SearchKind
  /** The order as Google names it. */
  order: string
  publishedAfter: string | undefined
  publishedBefore: string | undefined
  duration: string | undefined
  language: string | undefined
  region: string | undefined
  page: Page
}

/** A channel the caller asked for, as given and as `channelRef` reads it. */
export type ChannelAsk = { given: string; ref: ChannelRef }

/** What a read of comments asks Google for: the threads of a video, or the replies of a thread. */
export type CommentsRequest =
  | { video: string; order: (typeof COMMENT_ORDERS)[number]; searchTerms: string | undefined; page: Page }
  | { thread: string; page: Page }

export function refusal(message: string): ToolError {
  return new ToolError("invalid_argument", message)
}

/** `text` with its runs of whitespace made one space and its ends trimmed; empty or beyond `MAX_QUERY_CHARACTERS` is `invalid_argument`. */
function collapsed(name: string, text: string): string {
  const words = text.replace(/\s+/g, " ").trim()
  if (words === "") throw refusal(`\`${name}\` is empty.`)
  if (Array.from(words).length > MAX_QUERY_CHARACTERS) {
    throw refusal(`\`${name}\` is longer than ${MAX_QUERY_CHARACTERS} characters.`)
  }
  return words
}

/** `order` when `method` takes it, else `invalid_argument`; none is `relevance`. */
function orderOf<Order extends string>(method: string, order: string | undefined, allowed: readonly Order[]): Order {
  if (order === undefined) return "relevance" as Order
  const found = allowed.find((candidate) => candidate === order)
  if (found === undefined) throw refusal(`${method} takes an \`order\` of ${allowed.join(", ")}.`)
  return found
}

/** `day` when it is a real date as YYYY-MM-DD; else `invalid_argument`. */
export function checkedDay(name: string, day: string): string {
  const time = DAY_PATTERN.test(day) ? Date.parse(`${day}T00:00:00Z`) : Number.NaN
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== day) {
    throw refusal(`\`${name}\` is not a date as YYYY-MM-DD.`)
  }
  return day
}

/** `day` (YYYY-MM-DD, a real date) as RFC 3339 midnight UTC; else `invalid_argument`. */
function midnight(name: string, day: string): string {
  return `${checkedDay(name, day)}T00:00:00Z`
}

/** The arguments of a search, checked: the query, the channel, the dates, the language and region, and the order and duration for the kind. */
export function checkedSearch(args: YoutubeReadArgs): SearchRequest {
  const query = args.query === undefined ? undefined : collapsed("query", args.query)
  const channel = args.channel === undefined ? undefined : channelRef(args.channel)
  if (query === undefined && channel === undefined) throw refusal("Method search needs `query` or `channel`.")
  const kind = args.kind ?? "video"
  if (args.duration !== undefined && kind !== "video") throw refusal("`duration` goes with kind `video` only.")
  const publishedAfter =
    args.published_after === undefined ? undefined : midnight("published_after", args.published_after)
  const publishedBefore =
    args.published_before === undefined ? undefined : midnight("published_before", args.published_before)
  if (publishedAfter !== undefined && publishedBefore !== undefined && publishedAfter > publishedBefore) {
    throw refusal("`published_after` is later than `published_before`.")
  }
  if (args.language !== undefined && !LANGUAGE_PATTERN.test(args.language)) {
    throw refusal("`language` is not a language code such as `ja` or `zh-Hans`.")
  }
  if (args.region !== undefined && !REGION_PATTERN.test(args.region)) {
    throw refusal("`region` is not a two-letter country code such as `JP`.")
  }
  return {
    query,
    channel,
    kind,
    order: SEARCH_ORDER_NAMES[orderOf("Method search", args.order, SEARCH_ORDERS)],
    publishedAfter,
    publishedBefore,
    duration: args.duration,
    language: args.language,
    region: args.region?.toUpperCase(),
    page: pageOf("search", args.limit, args.page_token),
  }
}

/** The video ids of `videos`, each as an id and none twice, in the order given. */
export function checkedVideos(videos: readonly string[]): string[] {
  return [...new Set(videos.map(videoId))]
}

/** The channels of `channels` as asked, none twice (a handle however its letters are cased), in the order given. */
export function checkedChannels(channels: readonly string[]): ChannelAsk[] {
  const asks = new Map<string, ChannelAsk>()
  for (const given of channels) {
    const ref = channelRef(given)
    const key = ref.id !== undefined ? ref.id : ref.handle.toLowerCase()
    if (!asks.has(key)) asks.set(key, { given, ref })
  }
  return [...asks.values()]
}

/** The arguments of a read of comments, checked: exactly one of `video` and `thread`, and `order` and `search_terms` only with a video. */
export function checkedComments(args: YoutubeReadArgs): CommentsRequest {
  const { video, thread } = args
  const page = pageOf("comments", args.limit, args.page_token)
  if (video !== undefined && thread === undefined) {
    return {
      video: videoId(video),
      order: orderOf("Method comments", args.order, COMMENT_ORDERS),
      searchTerms: args.search_terms === undefined ? undefined : collapsed("search_terms", args.search_terms),
      page,
    }
  }
  if (thread !== undefined && video === undefined) {
    const stray = (["order", "search_terms"] as const).find((name) => args[name] !== undefined)
    if (stray !== undefined) throw refusal(`Method comments takes no \`${stray}\` with \`thread\`.`)
    return { thread: commentId(thread), page }
  }
  throw refusal("Method comments needs exactly one of `video` and `thread`.")
}
