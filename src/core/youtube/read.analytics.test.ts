import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import type { FakeHandler } from "../google/fake-google.testing"
import {
  ANALYTICS_URL,
  CHANNEL,
  CHANNELS_URL,
  OTHER_VIDEO,
  READ_ONLY_CREDENTIAL,
  VIDEO,
  VIDEOS_URL,
  answer,
  cleanUp,
  fixture,
  freshTokens,
  queryOf,
  refusal,
  requestLine,
  respond,
} from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const DEFAULT_METRICS =
  "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,comments,shares"

/** The clock of the fixtures is 2026-06-01T12:00:00Z. */
const TODAY = "2026-06-01"

const own = answer(CHANNELS_URL, { items: [{ id: CHANNEL }] })

const report = (columns: string[], rows?: (string | number)[][]) => ({
  kind: "youtubeAnalytics#resultTable",
  columnHeaders: columns.map((name) => ({ name, columnType: "METRIC", dataType: "INTEGER" })),
  ...(rows && { rows }),
})

const fixtureOf = (reply: unknown, ...more: FakeHandler[]) => fixture([own, answer(ANALYTICS_URL, reply), ...more])

/** The query of the report call, the second the fake received. */
const reportQuery = (h: Awaited<ReturnType<typeof fixtureOf>>) => queryOf(h, 1)

describe("google_youtube_read analytics request", () => {
  test("checks the channel, then asks for the default metrics over the 28 days to today", async () => {
    const h = await fixtureOf(report(["views"], [[10]]))

    await h.read({ method: "analytics" })

    expect(h.calls().map(requestLine)).toEqual([`GET ${CHANNELS_URL}`, `GET ${ANALYTICS_URL}`])
    expect(queryOf(h, 0)).toEqual({ part: "id", mine: "true" })
    expect(reportQuery(h)).toEqual({
      ids: "channel==MINE",
      startDate: "2026-05-05",
      endDate: TODAY,
      metrics: DEFAULT_METRICS,
    })
  })

  test("an end alone starts 27 days before it, a start alone ends today", async () => {
    const withEnd = await fixtureOf(report(["views"]))
    await withEnd.read({ method: "analytics", end: "2026-03-31" })
    expect(reportQuery(withEnd)).toMatchObject({ startDate: "2026-03-04", endDate: "2026-03-31" })
    await cleanUp()

    const withStart = await fixtureOf(report(["views"]))
    await withStart.read({ method: "analytics", start: "2026-01-01" })
    expect(reportQuery(withStart)).toMatchObject({ startDate: "2026-01-01", endDate: TODAY })
  })

  test("sends the metrics, dimensions, filters, sort and days as given", async () => {
    const h = await fixtureOf(report(["country", "views"]))

    await h.read({
      method: "analytics",
      metrics: "views,likes",
      dimensions: "country",
      filters: "country==JP;playlist==PLmadeUp",
      sort: "-likes",
      start: "2026-02-01",
      end: "2026-02-28",
      limit: 200,
    })

    expect(reportQuery(h)).toEqual({
      ids: "channel==MINE",
      startDate: "2026-02-01",
      endDate: "2026-02-28",
      metrics: "views,likes",
      dimensions: "country",
      filters: "country==JP;playlist==PLmadeUp",
      sort: "-likes",
      maxResults: "200",
    })
  })

  test.each([
    ["no dimensions", undefined, undefined],
    ["the day", "day", undefined],
    ["the month", "month", undefined],
    ["a country", "country", "50"],
    ["the day and a country", "day,country", "50"],
  ])("with %s, maxResults is %s", async (_name, dimensions, maxResults) => {
    const h = await fixtureOf(report(["views"]))

    await h.read({ method: "analytics", dimensions })

    expect(reportQuery(h).maxResults as string | undefined).toBe(maxResults)
  })

  test("the videos are added to the filters with a semicolon, none twice, ids and addresses alike", async () => {
    const h = await fixtureOf(report(["views"]))

    await h.read({
      method: "analytics",
      filters: "country==JP",
      videos: [VIDEO, `https://www.youtube.com/watch?v=${OTHER_VIDEO}`, VIDEO],
    })

    expect(reportQuery(h).filters).toBe(`country==JP;video==${VIDEO},${OTHER_VIDEO}`)
  })

  test("the videos alone are the filters", async () => {
    const h = await fixtureOf(report(["views"]))

    await h.read({ method: "analytics", videos: [VIDEO] })

    expect(reportQuery(h).filters).toBe(`video==${VIDEO}`)
  })

  test("a report by video with no sort is sorted by its first metric, descending; a sort given wins", async () => {
    const byVideo = await fixtureOf(report(["video", "likes"]))
    await byVideo.read({ method: "analytics", metrics: "likes,views", dimensions: "day,video" })
    expect(reportQuery(byVideo).sort).toBe("-likes")
    await cleanUp()

    const sorted = await fixtureOf(report(["video", "views"]))
    await sorted.read({ method: "analytics", dimensions: "video", sort: "views" })
    expect(reportQuery(sorted).sort).toBe("views")
    await cleanUp()

    const byCountry = await fixtureOf(report(["country", "views"]))
    await byCountry.read({ method: "analytics", dimensions: "country" })
    expect(reportQuery(byCountry).sort).toBeUndefined()
  })

  test("a label logged in with --read-only reads reports", async () => {
    const h = await fixture([own, answer(ANALYTICS_URL, report(["views"], [[3]]))], READ_ONLY_CREDENTIAL)

    expect((await h.read({ method: "analytics" })).rows).toEqual([[3]])
  })
})

describe("google_youtube_read analytics result", () => {
  test("returns the days, the columns, the rows as Google gives them and a note, with no titles", async () => {
    const h = await fixtureOf(
      report(
        ["day", "views"],
        [
          ["2026-05-30", 12],
          ["2026-05-31", "7"],
        ],
      ),
    )

    expect(await h.read({ method: "analytics", metrics: "views", dimensions: "day" })).toEqual({
      start: "2026-05-05",
      end: TODAY,
      columns: ["day", "views"],
      rows: [
        ["2026-05-30", 12],
        ["2026-05-31", "7"],
      ],
      titles: null,
      note: "YouTube Analytics leaves out the most recent two to three days until their data is final; averageViewDuration is in seconds and estimatedMinutesWatched in minutes.",
    })
  })

  test("a report with no rows has an empty list", async () => {
    const h = await fixtureOf(report(["views"]))

    expect(await h.read({ method: "analytics" })).toMatchObject({ columns: ["views"], rows: [], titles: null })
  })

  test("a video column gets the titles of its videos from one call, a video Google did not return left out", async () => {
    const h = await fixtureOf(
      report(
        ["video", "views"],
        [
          [VIDEO, 9],
          [OTHER_VIDEO, 4],
        ],
      ),
      answer(VIDEOS_URL, { items: [{ id: VIDEO, snippet: { title: "A made-up video" } }] }),
    )

    const result = await h.read({ method: "analytics", dimensions: "video", metrics: "views" })

    expect(h.calls().map(requestLine)).toEqual([`GET ${CHANNELS_URL}`, `GET ${ANALYTICS_URL}`, `GET ${VIDEOS_URL}`])
    expect(queryOf(h, 2)).toEqual({ part: "snippet", id: `${VIDEO},${OTHER_VIDEO}` })
    expect(result.titles).toEqual({ [VIDEO]: "A made-up video" })
  })

  test("a report by video with no rows has no titles and asks for none", async () => {
    const h = await fixtureOf(report(["video", "views"]), answer(VIDEOS_URL, { items: [] }))

    expect((await h.read({ method: "analytics", dimensions: "video" })).titles).toEqual({})
    expect(h.calls()).toHaveLength(2)
  })

  test("only the first 50 videos of a report are looked up", async () => {
    const ids = Array.from({ length: 60 }, (_, index) => `video${String(index).padStart(6, "0")}`)
    const h = await fixtureOf(
      report(
        ["video", "views"],
        ids.map((id) => [id, 1]),
      ),
      answer(VIDEOS_URL, { items: [] }),
    )

    await h.read({ method: "analytics", dimensions: "video" })

    expect(queryOf(h, 2).id).toBe(ids.slice(0, 50).join(","))
  })
})

describe("google_youtube_read analytics refusals", () => {
  test("an account with no channel is not_found, and no report is asked for", async () => {
    const h = await fixture([answer(CHANNELS_URL, {}), answer(ANALYTICS_URL, report(["views"]))])

    await expect(h.read({ method: "analytics" })).rejects.toMatchObject({
      code: "not_found",
      message: expect.stringContaining('Google account "work" has no YouTube channel'),
    })
    expect(h.calls()).toHaveLength(1)
  })

  test("Google's message for a combination it does not report is kept", async () => {
    const h = await fixture([
      own,
      respond(ANALYTICS_URL, refusal(400, "badRequest", "The dimensions and metrics cannot be queried together.")),
    ])

    const error = await toolError(h.read({ method: "analytics", metrics: "views", dimensions: "country,video" }))

    expect(error.message).toContain("The dimensions and metrics cannot be queried together.")
  })

  test.each([
    ["metrics with a space", { metrics: "views, likes" }, "`metrics`"],
    ["metrics with a digit", { metrics: "views2" }, "`metrics`"],
    ["empty metrics", { metrics: "" }, "`metrics`"],
    ["dimensions with a semicolon", { dimensions: "day;video" }, "`dimensions`"],
    ["filters without a value", { filters: "country==" }, "`filters`"],
    ["filters with a single equals sign", { filters: "country=JP" }, "`filters`"],
    ["filters with a space", { filters: "country==J P" }, "`filters`"],
    ["a sort with a plus", { sort: "+views" }, "`sort`"],
    ["a sort with two minuses", { sort: "--views" }, "`sort`"],
    ["a start that is no date", { start: "2026-13-01" }, "`start` is not a date as YYYY-MM-DD."],
    ["a start that is not shaped as a date", { start: "June 1" }, "`start` is not a date as YYYY-MM-DD."],
    ["an end that is no date", { end: "2026-02-30" }, "`end` is not a date as YYYY-MM-DD."],
    ["a start after the end", { start: "2026-03-02", end: "2026-03-01" }, "`start` is later than `end`."],
    ["a start after today", { start: "2026-06-02" }, "`start` is later than `end`."],
    ["videos that are no videos", { videos: ["short"] }, '"short"'],
    ["a limit of 0", { limit: 0 }, undefined],
    ["a limit of 201", { limit: 201 }, undefined],
    ["a query", { query: "x" }, "Method analytics takes no `query`."],
    ["a video", { video: VIDEO }, "Method analytics takes no `video`."],
    ["a page token", { page_token: "tok" }, "Method analytics takes no `page_token`."],
  ])("%s is invalid_argument, and sends nothing", async (_name, extra, message) => {
    const h = await fixtureOf(report(["views"]))

    const error = await toolError(h.read({ method: "analytics", ...extra }))

    expect(error.code).toBe("invalid_argument")
    if (message !== undefined) expect(error.message).toContain(message)
    expect(h.requests).toEqual([])
  })
})
