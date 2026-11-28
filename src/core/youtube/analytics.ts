import { parseReply } from "../sheets/reply"
import { ANALYTICS_NOTE, VIDEO_COLUMN, analyticsReply, type AnalyticsRow } from "./analytics-view"
import { checkedDay, checkedVideos, refusal } from "./args"
import { listVideos } from "./calls"
import { ownChannel, type OwnSession } from "./own-calls"
import { pageOf } from "./paging"
import { YOUTUBE_ROUTES } from "./routes"
import { DEFAULT_ANALYTICS_METRICS, DEFAULT_ANALYTICS_WINDOW_DAYS, MAX_LOOKUPS, type YoutubeReadArgs } from "./schemas"

/** A comma-separated list of names: metrics, dimensions. */
const NAMES_PATTERN = /^[A-Za-z]+(?:,[A-Za-z]+)*$/

/** `name==value` pairs, a value one or more comma-separated ones, joined by `;`. */
const FILTERS_PATTERN = /^[A-Za-z]+==[A-Za-z0-9_,.-]+(?:;[A-Za-z]+==[A-Za-z0-9_,.-]+)*$/

/** Comma-separated metric names, each with an optional `-` for a descending order. */
const SORT_PATTERN = /^-?[A-Za-z]+(?:,-?[A-Za-z]+)*$/

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** The dimensions whose report holds a row for each day or month, which a row limit does not apply to. */
const UNLIMITED_DIMENSIONS: readonly string[] = ["day", "month"]

/** What a report asks Google for, every argument checked. */
export type AnalyticsRequest = {
  /** YYYY-MM-DD. */
  start: string
  /** YYYY-MM-DD. */
  end: string
  metrics: string
  dimensions: string | undefined
  filters: string | undefined
  sort: string | undefined
  /** Sent only for a report that has dimensions other than `day` or `month`. */
  maxResults: number | undefined
}

/** What an analytics call returns. */
export type AnalyticsResult = {
  start: string
  end: string
  columns: string[]
  rows: AnalyticsRow[]
  titles: Record<string, string> | null
  note: string
}

/** `value` when it is shaped as `pattern` says, else `invalid_argument` saying what it must be. */
function checkedShape(name: string, value: string, pattern: RegExp, shape: string): string {
  if (!pattern.test(value)) throw refusal(`\`${name}\` is not ${shape}.`)
  return value
}

/** The day `ms` falls on in UTC, YYYY-MM-DD. */
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/**
 * The arguments of a report, checked. `now` is the clock, asked only when
 * `end` is left out: the report then ends today (UTC) and, without a `start`,
 * starts `DEFAULT_ANALYTICS_WINDOW_DAYS` days before its end.
 */
export function checkedAnalytics(args: YoutubeReadArgs, now: () => number): AnalyticsRequest {
  const metrics = checkedShape(
    "metrics",
    args.metrics ?? DEFAULT_ANALYTICS_METRICS,
    NAMES_PATTERN,
    "a comma-separated list of metric names such as `views,likes`",
  )
  const dimensions =
    args.dimensions === undefined
      ? undefined
      : checkedShape(
          "dimensions",
          args.dimensions,
          NAMES_PATTERN,
          "a comma-separated list of dimension names such as `day`",
        )
  const given =
    args.filters === undefined
      ? undefined
      : checkedShape(
          "filters",
          args.filters,
          FILTERS_PATTERN,
          "`name==value` pairs joined by `;`, such as `country==JP`",
        )
  const sort =
    args.sort === undefined
      ? undefined
      : checkedShape(
          "sort",
          args.sort,
          SORT_PATTERN,
          "a comma-separated list of metric names, each with an optional `-` in front",
        )
  const videos = args.videos === undefined ? undefined : checkedVideos(args.videos)
  const filters = [given, videos && `video==${videos.join(",")}`].filter((part) => part !== undefined).join(";")
  const end = args.end === undefined ? dayOf(now()) : checkedDay("end", args.end)
  const start =
    args.start === undefined
      ? dayOf(Date.parse(`${end}T00:00:00Z`) - DEFAULT_ANALYTICS_WINDOW_DAYS * MS_PER_DAY)
      : checkedDay("start", args.start)
  if (start > end) throw refusal("`start` is later than `end`.")
  const { maxResults } = pageOf("analytics", args.limit, undefined)
  return {
    start,
    end,
    metrics,
    dimensions,
    filters: filters === "" ? undefined : filters,
    sort: sort ?? (dimensions?.split(",").includes(VIDEO_COLUMN) ? `-${metrics.split(",")[0]}` : undefined),
    maxResults: dimensions === undefined || UNLIMITED_DIMENSIONS.includes(dimensions) ? undefined : maxResults,
  }
}

/** The titles of the videos `ids` name, the first `MAX_LOOKUPS` of them; one a call does not return is left out. */
async function titlesOf(session: OwnSession, ids: readonly string[]): Promise<Record<string, string>> {
  const first = [...new Set(ids)].slice(0, MAX_LOOKUPS)
  if (first.length === 0) return {}
  const videos = await listVideos(session.client, first, "snippet")
  return Object.fromEntries(videos.map((video) => [video.id, video.snippet?.title ?? ""]))
}

/**
 * The report of the label's own channel; an account with no YouTube channel is
 * `not_found`. A report with a `video` column comes with the titles of the
 * videos it names.
 */
export async function readAnalytics(session: OwnSession, request: AnalyticsRequest): Promise<AnalyticsResult> {
  await ownChannel(session, "id")
  const reply = await session.client.request(YOUTUBE_ROUTES.analytics, {
    query: {
      ids: "channel==MINE",
      startDate: request.start,
      endDate: request.end,
      metrics: request.metrics,
      dimensions: request.dimensions,
      filters: request.filters,
      sort: request.sort,
      maxResults: request.maxResults,
    },
  })
  const report = parseReply(analyticsReply, reply, "the report")
  const columns = (report.columnHeaders ?? []).map((header) => header.name)
  const rows = report.rows ?? []
  const videoColumn = columns.indexOf(VIDEO_COLUMN)
  return {
    start: request.start,
    end: request.end,
    columns,
    rows,
    titles:
      videoColumn === -1
        ? null
        : await titlesOf(
            session,
            rows.map((row) => String(row[videoColumn])),
          ),
    note: ANALYTICS_NOTE,
  }
}
