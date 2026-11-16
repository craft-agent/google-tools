import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  ANCHOR_ID,
  BATCH_UPDATE_URL,
  CELL_B2,
  FILE_ID,
  ME,
  OTHER,
  SPREADSHEET_ID,
  THREAD_ID,
  answer,
  callOf,
  changeFixture,
  cleanUp,
  commentsUrl,
  deleteTo,
  driveComment,
  driveFile,
  driveReply,
  fileUrl,
  freshTokens,
  post,
  postTo,
  refusal,
  saved,
  sheetsHandlers,
  sheetsTab,
  sheetsThread,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const TABS = [sheetsTab(7, "Plan", [[ANCHOR_ID, CELL_B2]])]

/** A thread whose first post the account wrote, with replies `p1` (the account's), `p2` (another person's, deleted) and `p3` (another person's), and `p4` (a resolve action) and `p5` (an assignee) of the account's. */
const THREAD = sheetsThread(THREAD_ID, {
  headPost: post(`${THREAD_ID}-head`, { author: ME, content: "My old words." }),
  replies: [
    post("p1", { author: ME, content: "My reply." }),
    post("p2", { author: OTHER, deleted: true }),
    post("p3", { author: OTHER, content: "Theirs." }),
    post("p4", { author: ME, content: "", commentAction: "RESOLVE" }),
    post("p5", { author: ME, assigneeEmail: "ann@example.test" }),
  ],
})

const sheets = (threads: unknown[] = [THREAD], reply: unknown = saved()) =>
  changeFixture([postTo(BATCH_UPDATE_URL, { json: reply }), ...sheetsHandlers(threads, TABS)])

const COMMENT_URL = `${commentsUrl(FILE_ID)}/c1`
const FILE = answer(fileUrl(FILE_ID), driveFile(FILE_ID, { name: "Notes.pdf" }))

const REPLIES = [driveReply("r1", { author: ME, content: "Done." }), driveReply("r2", { author: OTHER, deleted: true })]

/** A PDF fixture: the account's comment `c1` with replies `r1` and a deleted `r2`, and the DELETEs of the comment and of `r1` answering `reply`, as Google does: 204 with no body. */
const drive = (comment: Record<string, unknown> = {}, reply: Record<string, unknown> = { status: 204 }) =>
  changeFixture([
    FILE,
    answer(COMMENT_URL, driveComment("c1", { author: ME, replies: REPLIES, ...comment })),
    deleteTo(COMMENT_URL, reply),
    deleteTo(`${COMMENT_URL}/replies/r1`, reply),
  ])

describe("google_comments_delete: a spreadsheet", () => {
  test("sends one deleteComment for the thread and counts the live replies that went with it", async () => {
    const h = await sheets()

    const result = await h.remove({ file: SPREADSHEET_ID, comment_id: THREAD_ID })

    expect(result).toEqual({
      file_id: SPREADSHEET_ID,
      comment_id: THREAD_ID,
      reply_id: null,
      deleted_text: "My old words.",
      replies_deleted: 4,
    })
    expect(h.calls().map(callOf)).toEqual([
      `GET https://www.googleapis.com/drive/v3/files/${SPREADSHEET_ID}`,
      `GET https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`,
      `POST https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`,
    ])
    expect(h.writes()[0]?.json).toEqual({ requests: [{ deleteComment: { commentId: THREAD_ID } }] })
  })

  test("sends one deleteCommentReply for a reply, which takes no other post with it", async () => {
    const h = await sheets()

    const result = await h.remove({ file: SPREADSHEET_ID, comment_id: THREAD_ID, reply_id: "p1" })

    expect(result).toEqual({
      file_id: SPREADSHEET_ID,
      comment_id: THREAD_ID,
      reply_id: "p1",
      deleted_text: "My reply.",
      replies_deleted: 0,
    })
    expect(h.writes()[0]?.json).toEqual({
      requests: [{ deleteCommentReply: { commentId: THREAD_ID, postId: "p1" } }],
    })
  })

  test("`deleted_text` is clipped like the read clips", async () => {
    const head = post("h", { author: ME, content: "あ".repeat(4001) })
    const h = await sheets([sheetsThread(THREAD_ID, { headPost: head })])

    expect((await h.remove({ file: SPREADSHEET_ID, comment_id: THREAD_ID })).deleted_text).toBe("あ".repeat(4000))
  })

  test.each([
    ["a reply that resolves the thread", "p4"],
    ["a reply that carries an assignee", "p5"],
  ])("%s is invalid_argument, saying Google keeps it, before any write", async (_name, reply_id) => {
    const h = await sheets()

    await expect(h.remove({ file: SPREADSHEET_ID, comment_id: THREAD_ID, reply_id })).rejects.toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining("Google keeps"),
    })
    expect(h.writes()).toEqual([])
  })

  test("the whole thread goes even where its replies resolve or assign, since only a reply alone is kept", async () => {
    const h = await sheets()

    await h.remove({ file: SPREADSHEET_ID, comment_id: THREAD_ID })

    expect(h.writes()).toHaveLength(1)
  })

  test.each([
    ["a thread Google does not list", { comment_id: "missing" }],
    ["a reply that was deleted", { comment_id: THREAD_ID, reply_id: "p2" }],
    ["a reply the thread lacks", { comment_id: THREAD_ID, reply_id: "missing" }],
  ])("%s is not_found, before any write", async (_name, args) => {
    const h = await sheets()

    await expect(h.remove({ file: SPREADSHEET_ID, ...args })).rejects.toMatchObject({ code: "not_found" })
    expect(h.writes()).toEqual([])
  })

  test("a state other than ALL_SAVED fails the call as upstream_error, naming it", async () => {
    const h = await sheets([THREAD], { commentUpdateState: "ALL_FAILED_UNKNOWN_REASON" })

    await expect(h.remove({ file: SPREADSHEET_ID, comment_id: THREAD_ID })).rejects.toMatchObject({
      code: "upstream_error",
      message: expect.stringContaining("ALL_FAILED_UNKNOWN_REASON"),
    })
  })
})

describe("google_comments_delete: another file", () => {
  test("deletes the comment with no body, and an empty 204 answer is a success", async () => {
    const h = await drive()

    const result = await h.remove({ file: FILE_ID, comment_id: "c1" })

    expect(result).toEqual({
      file_id: FILE_ID,
      comment_id: "c1",
      reply_id: null,
      deleted_text: "Please check this paragraph.",
      replies_deleted: 1,
    })
    expect(h.calls().map(callOf)).toEqual([
      `GET https://www.googleapis.com/drive/v3/files/${FILE_ID}`,
      `GET https://www.googleapis.com/drive/v3/files/${FILE_ID}/comments/c1`,
      `DELETE https://www.googleapis.com/drive/v3/files/${FILE_ID}/comments/c1`,
    ])
    expect(h.writes()[0]?.body).toBeUndefined()
  })

  test("deletes a reply at its own address", async () => {
    const h = await drive()

    const result = await h.remove({ file: FILE_ID, comment_id: "c1", reply_id: "r1" })

    expect(result).toMatchObject({ reply_id: "r1", deleted_text: "Done.", replies_deleted: 0 })
    expect(callOf(h.writes()[0]!)).toBe(
      `DELETE https://www.googleapis.com/drive/v3/files/${FILE_ID}/comments/c1/replies/r1`,
    )
  })

  test.each([
    ["a deleted comment", { deleted: true }, "c1", undefined],
    ["a reply that was deleted", {}, "c1", "r2"],
    ["a reply the comment lacks", {}, "c1", "missing"],
  ])("%s is not_found", async (_name, comment, comment_id, reply_id) => {
    const h = await drive(comment)

    await expect(h.remove({ file: FILE_ID, comment_id, reply_id })).rejects.toMatchObject({ code: "not_found" })
    expect(h.writes()).toEqual([])
  })

  test.each([
    ["a 403", 403, "forbidden"],
    ["a 404", 404, "notFound"],
  ])("%s on the write is the forbidden refusal, for the comment and for a reply", async (_name, status, reason) => {
    const h = await drive({}, refusal(status, reason, "Refused."))
    const refused = (what: string) => ({
      code: "forbidden",
      message: `Google refused to ${what}: these tools can change comments only on spreadsheets and on the files they created (drive.file), and nothing was changed.`,
      details: { status },
    })

    await expect(h.remove({ file: FILE_ID, comment_id: "c1" })).rejects.toMatchObject(refused("delete the comment"))
    await expect(h.remove({ file: FILE_ID, comment_id: "c1", reply_id: "r1" })).rejects.toMatchObject(
      refused("delete the reply"),
    )
  })

  test("a rate limit is not turned into a refusal", async () => {
    const h = await drive({}, refusal(429, "rateLimitExceeded", "Slow down."))

    await expect(h.remove({ file: FILE_ID, comment_id: "c1" })).rejects.toMatchObject({ code: "rate_limited" })
  })
})
