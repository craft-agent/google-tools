import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { SPREADSHEET_MIME_TYPE } from "../drive/kinds"
import {
  ANCHOR_ID,
  CELL_B2,
  SPREADSHEET_ID,
  SPREADSHEET_URL,
  answer,
  cleanUp,
  driveFile,
  fileUrl,
  fixture,
  freshTokens,
  post,
  sheetsTab,
  sheetsThread,
} from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const SPREADSHEET_FILE = driveFile(SPREADSHEET_ID, { name: "Budget 2026", mimeType: SPREADSHEET_MIME_TYPE })

/** A fixture whose spreadsheet answers `comments` and `sheets`; the first tab is `Plan`, with the anchor on B2. */
const sheetsFixtureOf = (comments: unknown[], sheets: unknown[] = [sheetsTab(0, "Plan", [[ANCHOR_ID, CELL_B2]])]) =>
  fixture([answer(fileUrl(SPREADSHEET_ID), SPREADSHEET_FILE), answer(SPREADSHEET_URL, { comments, sheets })])

describe("google_comments_read: a spreadsheet", () => {
  test("returns the file and each thread with its cell, quote, author and time", async () => {
    const h = await sheetsFixtureOf([sheetsThread("t1")])

    expect(await h.read({ file: SPREADSHEET_ID })).toEqual({
      file_id: SPREADSHEET_ID,
      name: "Budget 2026",
      kind: "google_sheet",
      web_view_link: `https://drive.google.com/file/d/${SPREADSHEET_ID}/view`,
      comments: [
        {
          comment_id: "t1",
          status: "open",
          at: "Plan!B2",
          quote: "42",
          author: "Ann Example",
          me: false,
          text: "Please check this figure.",
          text_clipped: false,
          time: "2026-06-01T09:30:00Z",
          assignee: null,
          replies: [],
        },
      ],
      resolved_hidden: 0,
      more: 0,
      incomplete: false,
    })
  })

  test("reads the file with the fields it needs, then the spreadsheet with the comments view and its anchors", async () => {
    const h = await sheetsFixtureOf([])

    await h.read({ file: SPREADSHEET_ID })

    const [file, spreadsheet] = h.calls()
    expect(file?.url.searchParams.get("fields")).toBe("id,name,mimeType,webViewLink,shortcutDetails")
    expect(file?.url.searchParams.get("supportsAllDrives")).toBe("true")
    expect(spreadsheet?.url.searchParams.get("commentsViewMode")).toBe("COMMENTS_VIEW_MODE_INCLUDED")
    expect(spreadsheet?.url.searchParams.get("fields")).toBe(
      "comments,sheets(properties(sheetId,title),commentAnchors)",
    )
    expect(spreadsheet?.url.searchParams.has("ranges")).toBe(false)
    expect(h.calls()).toHaveLength(2)
  })

  test("`ranges` are sent as repeated query values", async () => {
    const h = await sheetsFixtureOf([])

    await h.read({ file: SPREADSHEET_ID, ranges: ["Plan!A1:C3", "'My tab'!B:B"] })

    expect(h.calls()[1]?.url.searchParams.getAll("ranges")).toEqual(["Plan!A1:C3", "'My tab'!B:B"])
  })

  test("an anchor is a cell, a range of cells, or a quoted tab's cell; a thread with no known anchor has none", async () => {
    const sheets = [
      sheetsTab(0, "Plan", [
        ["one", CELL_B2],
        ["many", { startRowIndex: 1, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 3 }],
        ["first", { endRowIndex: 1, endColumnIndex: 1 }],
      ]),
      sheetsTab(7, "Q1 it's", [["quoted", CELL_B2]]),
    ]
    const h = await sheetsFixtureOf(
      [
        sheetsThread("a", { anchorId: "one" }),
        sheetsThread("b", { anchorId: "many" }),
        sheetsThread("c", { anchorId: "quoted" }),
        sheetsThread("d", { anchorId: "first" }),
        sheetsThread("e", { anchorId: undefined }),
        sheetsThread("f", { anchorId: "unknown" }),
      ],
      sheets,
    )

    const { comments } = await h.read({ file: SPREADSHEET_ID })

    expect(comments.map((thread: { at: string | null }) => thread.at)).toEqual([
      "Plan!B2",
      "Plan!B2:C3",
      "'Q1 it''s'!B2",
      "Plan!A1",
      null,
      null,
    ])
  })

  test("an anchor whose tab the reply does not list has no cell", async () => {
    const h = await sheetsFixtureOf(
      [sheetsThread("a", { anchorId: "lost" })],
      [sheetsTab(0, "Plan"), { commentAnchors: [{ anchorId: "lost", range: { sheetId: 9, ...CELL_B2 } }] }],
    )

    expect((await h.read({ file: SPREADSHEET_ID })).comments[0].at).toBeNull()
  })

  test("resolved threads are left out and counted, unless `resolved` is true", async () => {
    const h = await sheetsFixtureOf([sheetsThread("open"), sheetsThread("done", { status: "RESOLVED" })])

    const hidden = await h.read({ file: SPREADSHEET_ID })
    const shown = await h.read({ file: SPREADSHEET_ID, resolved: true })

    expect(hidden.comments.map((thread: { comment_id: string }) => thread.comment_id)).toEqual(["open"])
    expect(hidden.resolved_hidden).toBe(1)
    expect(shown.comments.map((thread: { comment_id: string; status: string }) => thread.status)).toEqual([
      "open",
      "resolved",
    ])
    expect(shown.resolved_hidden).toBe(0)
  })

  test("a thread whose first post was deleted, and deleted replies, are left out", async () => {
    const h = await sheetsFixtureOf([
      sheetsThread("gone", { headPost: post("p0", { deleted: true, content: undefined, author: undefined }) }),
      sheetsThread("kept", { replies: [post("r1", { deleted: true }), post("r2", { content: "Fixed." })] }),
    ])

    const { comments } = await h.read({ file: SPREADSHEET_ID })

    expect(comments.map((thread: { comment_id: string }) => thread.comment_id)).toEqual(["kept"])
    expect(comments[0].replies.map((reply: { reply_id: string }) => reply.reply_id)).toEqual(["r2"])
  })

  test("a reply's author, actions and assignees are mapped, and a thread's own", async () => {
    const h = await sheetsFixtureOf([
      sheetsThread("t", {
        headPost: post("h", { author: { displayName: "Me Myself", me: true }, assigneeEmail: "ann@example.test" }),
        replies: [
          post("r1", { commentAction: "RESOLVE", updateTime: undefined }),
          post("r2", { commentAction: "REOPEN", assigneeEmail: "bob@example.test" }),
          post("r3", { commentAction: "NO_COMMENT_ACTION_CHANGE" }),
          post("r4", { commentAction: "COMMENT_ACTION_UNSPECIFIED", author: { me: false } }),
        ],
      }),
    ])

    const [thread] = (await h.read({ file: SPREADSHEET_ID })).comments

    expect(thread).toMatchObject({ author: "Me Myself", me: true, assignee: "ann@example.test" })
    expect(thread.replies.map((reply: object) => reply)).toMatchObject([
      { reply_id: "r1", action: "resolve", assignee: null, time: "2026-06-01T09:00:00Z" },
      { reply_id: "r2", action: "reopen", assignee: "bob@example.test", me: false },
      { reply_id: "r3", action: null },
      { reply_id: "r4", action: null, author: null },
    ])
  })

  test("`limit` keeps the first threads and `more` counts the rest of the open ones", async () => {
    const h = await sheetsFixtureOf([
      sheetsThread("a"),
      sheetsThread("b", { status: "RESOLVED" }),
      sheetsThread("c"),
      sheetsThread("d"),
    ])

    const result = await h.read({ file: SPREADSHEET_ID, limit: 2 })

    expect(result.comments.map((thread: { comment_id: string }) => thread.comment_id)).toEqual(["a", "c"])
    expect(result).toMatchObject({ resolved_hidden: 1, more: 1, incomplete: false })
  })

  test("a range Google cannot parse is invalid_argument carrying Google's text", async () => {
    const h = await fixture([
      answer(fileUrl(SPREADSHEET_ID), SPREADSHEET_FILE),
      {
        method: "GET",
        url: SPREADSHEET_URL,
        reply: {
          status: 400,
          json: { error: { code: 400, message: "Unable to parse range: Nope!A1", status: "INVALID_ARGUMENT" } },
        },
      },
    ])

    await expect(h.read({ file: SPREADSHEET_ID, ranges: ["Nope!A1"] })).rejects.toMatchObject({
      code: "invalid_argument",
      message: "Google: Unable to parse range: Nope!A1",
    })
  })

  test("a reply that is not a spreadsheet is upstream_error", async () => {
    const h = await fixture([
      answer(fileUrl(SPREADSHEET_ID), SPREADSHEET_FILE),
      answer(SPREADSHEET_URL, { comments: 5 }),
    ])

    await expect(h.read({ file: SPREADSHEET_ID })).rejects.toMatchObject({ code: "upstream_error" })
  })
})
