import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  ANCHOR_ID,
  BATCH_UPDATE_URL,
  CELL_B2,
  SPREADSHEET_ID,
  THREAD_ID,
  addFixture,
  assignedThread,
  callOf,
  cleanUp,
  freshTokens,
  postTo,
  saved,
  sheetsHandlers,
  sheetsTab,
  sheetsThread,
} from "./add.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

/** The tab `Plan` (id 7, first) with a thread anchored on its B2, the tab `Other` (id 9) and the tab `Q1 it's` (id 4) after it. */
const TABS = [
  { properties: { sheetId: 9, title: "Other", index: 1 } },
  sheetsTab(7, "Plan", [[ANCHOR_ID, CELL_B2]]),
  { properties: { sheetId: 4, title: "Q1 it's", index: 2 } },
]

const INSERTED = saved({ replies: [{ insertComment: { commentThread: { commentId: "new-thread" } } }] })
const REPLIED = saved({ replies: [{ addCommentReply: { post: { postId: "new-post" } } }] })

/** A fixture whose spreadsheet holds `threads` on `TABS` and whose batch update answers `reply`. */
const fixtureOf = (threads: unknown[] = [], reply: unknown = INSERTED) =>
  addFixture([postTo(BATCH_UPDATE_URL, { json: reply }), ...sheetsHandlers(threads, TABS)])

describe("google_comments_add: a new comment on a spreadsheet", () => {
  test("sends one insertComment with the cell's sheet, row and column and the assignee, and returns what it made", async () => {
    const h = await fixtureOf()

    const result = await h.add({
      file: SPREADSHEET_ID,
      cell: "Plan!B2",
      text: "Please check +bob@example.test",
      assignee: "Ann@Example.test",
    })

    expect(result).toEqual({
      file_id: SPREADSHEET_ID,
      comment_id: "new-thread",
      reply_id: null,
      at: "Plan!B2",
      assignee: "ann@example.test",
      emailed: ["ann@example.test", "bob@example.test"],
    })
    expect(h.writes()).toHaveLength(1)
    expect(callOf(h.writes()[0]!)).toBe(
      `POST https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`,
    )
    expect(h.writes()[0]?.json).toEqual({
      requests: [
        {
          insertComment: {
            content: "Please check +bob@example.test",
            coordinate: { sheetId: 7, rowIndex: 1, columnIndex: 1 },
            assigneeEmailAddress: "ann@example.test",
          },
        },
      ],
    })
  })

  test("reads the file, then the tabs, then writes", async () => {
    const h = await fixtureOf()

    await h.add({ file: SPREADSHEET_ID, cell: "Plan!B2", text: "Hi" })

    expect(h.calls().map(callOf)).toEqual([
      `GET https://www.googleapis.com/drive/v3/files/${SPREADSHEET_ID}`,
      `GET https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`,
      `POST https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`,
    ])
  })

  test("a comment with no assignee sends none, and a cell alone goes to the first tab", async () => {
    const h = await fixtureOf()

    const result = await h.add({ file: SPREADSHEET_ID, cell: "c3", text: "Hi" })

    expect(h.writes()[0]?.json).toEqual({
      requests: [{ insertComment: { content: "Hi", coordinate: { sheetId: 7, rowIndex: 2, columnIndex: 2 } } }],
    })
    expect(result).toMatchObject({ at: "Plan!C3", assignee: null, emailed: [] })
  })

  test.each([
    ["a tab named in another case", "other!c3", { sheetId: 9, rowIndex: 2, columnIndex: 2 }, "Other!C3"],
    ["a quoted tab", "'Q1 it''s'!AA10", { sheetId: 4, rowIndex: 9, columnIndex: 26 }, "'Q1 it''s'!AA10"],
    ["a cell written as a block of itself", "Plan!B2:B2", { sheetId: 7, rowIndex: 1, columnIndex: 1 }, "Plan!B2"],
    ["a cell with dollar signs", "Plan!$D$4", { sheetId: 7, rowIndex: 3, columnIndex: 3 }, "Plan!D4"],
  ])("%s is one cell, shown as the read shows it", async (_name, cell, coordinate, at) => {
    const h = await fixtureOf()

    const result = await h.add({ file: SPREADSHEET_ID, cell, text: "Hi" })

    expect(h.writes()[0]?.json).toMatchObject({ requests: [{ insertComment: { coordinate } }] })
    expect(result.at).toBe(at)
  })

  test("an id Google did not report is empty, and the comment is not failed for it", async () => {
    const h = await fixtureOf([], saved())

    expect(await h.add({ file: SPREADSHEET_ID, cell: "Plan!B2", text: "Hi" })).toMatchObject({
      comment_id: "",
      reply_id: null,
    })
  })
})

describe("google_comments_add: a reply on a spreadsheet", () => {
  test("sends addCommentReply with the thread's id and returns the post's id and the thread's cell", async () => {
    const h = await fixtureOf([sheetsThread(THREAD_ID)], REPLIED)

    const result = await h.add({ file: SPREADSHEET_ID, comment_id: THREAD_ID, text: "Done." })

    expect(h.writes()[0]?.json).toEqual({
      requests: [{ addCommentReply: { commentId: THREAD_ID, post: { content: "Done." } } }],
    })
    expect(result).toEqual({
      file_id: SPREADSHEET_ID,
      comment_id: THREAD_ID,
      reply_id: "new-post",
      at: "Plan!B2",
      assignee: null,
      emailed: [],
    })
  })

  test("reads the file and then the threads before it writes", async () => {
    const h = await fixtureOf([sheetsThread(THREAD_ID)], REPLIED)

    await h.add({ file: SPREADSHEET_ID, comment_id: THREAD_ID, text: "Done." })

    const [file, threads, write] = h.calls()
    expect(file?.url.pathname).toBe(`/drive/v3/files/${SPREADSHEET_ID}`)
    expect(threads?.url.searchParams.get("commentsViewMode")).toBe("COMMENTS_VIEW_MODE_INCLUDED")
    expect(write?.method).toBe("POST")
    expect(h.calls()).toHaveLength(3)
  })

  test("an assignee on a reply to an assigned thread reassigns it", async () => {
    const h = await fixtureOf([assignedThread(THREAD_ID)], REPLIED)

    const result = await h.add({
      file: SPREADSHEET_ID,
      comment_id: THREAD_ID,
      text: "Over to you.",
      assignee: "bob@example.test",
    })

    expect(h.writes()[0]?.json).toEqual({
      requests: [
        {
          addCommentReply: {
            commentId: THREAD_ID,
            post: { content: "Over to you.", assigneeEmail: "bob@example.test" },
          },
        },
      ],
    })
    expect(result).toMatchObject({ assignee: "bob@example.test", emailed: ["bob@example.test"] })
  })

  test("a reply Google answers with no post id has a null reply_id", async () => {
    const h = await fixtureOf([sheetsThread(THREAD_ID)], saved({ replies: [{ addCommentReply: {} }] }))

    expect((await h.add({ file: SPREADSHEET_ID, comment_id: THREAD_ID, text: "Done." })).reply_id).toBeNull()
  })

  test("a thread that is resolved still takes a reply, and one without a cell has no cell", async () => {
    const h = await fixtureOf([sheetsThread(THREAD_ID, { status: "RESOLVED", anchorId: undefined })], REPLIED)

    expect(await h.add({ file: SPREADSHEET_ID, comment_id: THREAD_ID, text: "Reopened?" })).toMatchObject({
      reply_id: "new-post",
      at: null,
    })
  })
})

describe("google_comments_add: what Google says of the comment", () => {
  test.each([
    ["ALL_FAILED_UNKNOWN_REASON", { commentUpdateState: "ALL_FAILED_UNKNOWN_REASON" }],
    ["NO_UPDATES_REQUESTED", { commentUpdateState: "NO_UPDATES_REQUESTED" }],
    ["COMMENT_UPDATE_STATE_UNSPECIFIED", { commentUpdateState: "COMMENT_UPDATE_STATE_UNSPECIFIED" }],
    ["COMMENT_UPDATE_STATE_UNSPECIFIED", {}],
  ])(
    "the state %s fails the call as upstream_error, naming it and saying to read the comments first",
    async (state, reply) => {
      const h = await fixtureOf([], reply)

      await expect(h.add({ file: SPREADSHEET_ID, cell: "Plan!B2", text: "Hi" })).rejects.toMatchObject({
        code: "upstream_error",
        message: expect.stringContaining(state),
      })
      await expect(h.add({ file: SPREADSHEET_ID, cell: "Plan!B2", text: "Hi" })).rejects.toMatchObject({
        message: expect.stringContaining("read the file's comments before trying again"),
      })
    },
  )

  test("a reply that is not a batch answer is upstream_error", async () => {
    const h = await fixtureOf([], { replies: 5 })

    await expect(h.add({ file: SPREADSHEET_ID, cell: "Plan!B2", text: "Hi" })).rejects.toMatchObject({
      code: "upstream_error",
    })
  })
})
