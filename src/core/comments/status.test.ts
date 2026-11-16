import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  ANCHOR_ID,
  BATCH_UPDATE_URL,
  CELL_B2,
  FILE_ID,
  SPREADSHEET_ID,
  THREAD_ID,
  answer,
  callOf,
  changeFixture,
  cleanUp,
  commentsUrl,
  driveComment,
  driveFile,
  fileUrl,
  freshTokens,
  postTo,
  refusal,
  respond,
  saved,
  sheetsHandlers,
  sheetsTab,
  sheetsThread,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

type Status = "open" | "resolved"

const TABS = [sheetsTab(7, "Plan", [[ANCHOR_ID, CELL_B2]])]

const COMMENT_URL = `${commentsUrl(FILE_ID)}/c1`
const REPLIES_URL = `${COMMENT_URL}/replies`

const FILE = answer(fileUrl(FILE_ID), driveFile(FILE_ID, { name: "Notes.pdf" }))

/** A spreadsheet fixture holding `threads`, whose batch update answers `reply`. */
const sheets = (threads: unknown[], reply: unknown = saved()) =>
  changeFixture([postTo(BATCH_UPDATE_URL, { json: reply }), ...sheetsHandlers(threads, TABS)])

/** A fixture of a PDF whose comment `c1` is `comment`, whose replies endpoint answers `reply`. */
const drive = (comment: Record<string, unknown> = {}, reply = postTo(REPLIES_URL, { json: { id: "r-new" } })) =>
  changeFixture([FILE, answer(COMMENT_URL, driveComment("c1", comment)), reply])

describe("google_comments_status: a spreadsheet", () => {
  test.each<[string, string, Status, Status, string]>([
    ["resolves an open thread", "OPEN", "resolved", "open", "RESOLVE"],
    ["reopens a resolved one", "RESOLVED", "open", "resolved", "REOPEN"],
  ])(
    "%s with one addCommentReply that carries the action and no text",
    async (_name, current, status, before, action) => {
      const h = await sheets([sheetsThread(THREAD_ID, { status: current })])

      const result = await h.status({ file: SPREADSHEET_ID, comment_id: THREAD_ID, status })

      expect(result).toEqual({ file_id: SPREADSHEET_ID, comment_id: THREAD_ID, status, before, changed: true })
      expect(h.calls().map(callOf)).toEqual([
        `GET https://www.googleapis.com/drive/v3/files/${SPREADSHEET_ID}`,
        `GET https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`,
        `POST https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`,
      ])
      expect(h.writes()[0]?.json).toEqual({
        requests: [{ addCommentReply: { commentId: THREAD_ID, post: { commentAction: action } } }],
      })
    },
  )

  test.each<[Status, string]>([
    ["open", "OPEN"],
    ["resolved", "RESOLVED"],
  ])("a thread that is %s already is not touched, and the result says so", async (status, current) => {
    const h = await sheets([sheetsThread(THREAD_ID, { status: current })])

    const result = await h.status({ file: SPREADSHEET_ID, comment_id: THREAD_ID, status })

    expect(result).toEqual({ file_id: SPREADSHEET_ID, comment_id: THREAD_ID, status, before: status, changed: false })
    expect(h.writes()).toEqual([])
  })

  test("a thread Google does not list, or whose first post was deleted, is not_found, before any write", async () => {
    const deleted = sheetsThread("gone", { headPost: { postId: "p", deleted: true } })
    const h = await sheets([sheetsThread(THREAD_ID), deleted])

    for (const comment_id of ["missing", "gone"]) {
      await expect(h.status({ file: SPREADSHEET_ID, comment_id, status: "resolved" })).rejects.toMatchObject({
        code: "not_found",
      })
    }
    expect(h.writes()).toEqual([])
  })

  test.each([
    ["ALL_FAILED_UNKNOWN_REASON", { commentUpdateState: "ALL_FAILED_UNKNOWN_REASON" }],
    ["COMMENT_UPDATE_STATE_UNSPECIFIED", {}],
  ])("the state %s fails the call as upstream_error, naming it", async (state, reply) => {
    const h = await sheets([sheetsThread(THREAD_ID)], reply)

    await expect(h.status({ file: SPREADSHEET_ID, comment_id: THREAD_ID, status: "resolved" })).rejects.toMatchObject({
      code: "upstream_error",
      message: expect.stringContaining(state),
    })
  })
})

describe("google_comments_status: another file", () => {
  test.each<[string, boolean, Status, Status, string]>([
    ["resolves an open comment", false, "resolved", "open", "resolve"],
    ["reopens a resolved one", true, "open", "resolved", "reopen"],
  ])("%s with one reply that carries the action, fields=id", async (_name, resolved, status, before, action) => {
    const h = await drive({ resolved })

    const result = await h.status({ file: FILE_ID, comment_id: "c1", status })

    expect(result).toEqual({ file_id: FILE_ID, comment_id: "c1", status, before, changed: true })
    const [, , write] = h.calls()
    expect(callOf(write!)).toBe(`POST https://www.googleapis.com/drive/v3/files/${FILE_ID}/comments/c1/replies`)
    expect(write?.json).toEqual({ action })
    expect(write?.url.searchParams.get("fields")).toBe("id")
    expect(h.calls()).toHaveLength(3)
  })

  test("a comment with the status already sends nothing", async () => {
    const h = await drive({ resolved: true })

    expect(await h.status({ file: FILE_ID, comment_id: "c1", status: "resolved" })).toMatchObject({
      before: "resolved",
      changed: false,
    })
    expect(h.writes()).toEqual([])
  })

  test.each([
    ["deleted", [FILE, answer(COMMENT_URL, driveComment("c1", { deleted: true }))]],
    ["unknown to Google", [FILE, respond(COMMENT_URL, refusal(404, "notFound", "Comment not found."))]],
  ])("a comment that is %s is not_found", async (_name, handlers) => {
    const h = await changeFixture(handlers)

    await expect(h.status({ file: FILE_ID, comment_id: "c1", status: "resolved" })).rejects.toMatchObject({
      code: "not_found",
    })
    expect(h.writes()).toEqual([])
  })

  test.each([
    ["a 403", 403, "forbidden"],
    ["a 404", 404, "notFound"],
  ])("%s on the write is the forbidden refusal, saying nothing was changed", async (_name, status, reason) => {
    const h = await drive({}, postTo(REPLIES_URL, refusal(status, reason, "Refused.")))

    await expect(h.status({ file: FILE_ID, comment_id: "c1", status: "resolved" })).rejects.toMatchObject({
      code: "forbidden",
      message:
        "Google refused to change the comment's status: these tools can change comments only on spreadsheets and on the files they created (drive.file), and nothing was changed.",
      details: { status },
    })
  })

  test("a rate limit is not turned into a refusal", async () => {
    const h = await drive({}, postTo(REPLIES_URL, refusal(429, "rateLimitExceeded", "Slow down.")))

    await expect(h.status({ file: FILE_ID, comment_id: "c1", status: "resolved" })).rejects.toMatchObject({
      code: "rate_limited",
    })
  })
})
