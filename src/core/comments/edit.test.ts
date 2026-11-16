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
  driveComment,
  driveFile,
  driveReply,
  fileUrl,
  freshTokens,
  patchTo,
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

/** A thread whose first post and reply `p1` the account wrote, and reply `p2` another person wrote. */
const MINE = sheetsThread(THREAD_ID, {
  headPost: post(`${THREAD_ID}-head`, { author: ME, content: "My old words." }),
  replies: [post("p1", { author: ME, content: "My reply." }), post("p2", { author: OTHER, content: "Theirs." })],
})

const sheets = (threads: unknown[] = [MINE], reply: unknown = saved()) =>
  changeFixture([postTo(BATCH_UPDATE_URL, { json: reply }), ...sheetsHandlers(threads, TABS)])

const COMMENT_URL = `${commentsUrl(FILE_ID)}/c1`
const FILE = answer(fileUrl(FILE_ID), driveFile(FILE_ID, { name: "Notes.pdf" }))

const REPLIES = [driveReply("r1", { author: ME, content: "Done." }), driveReply("r2", { author: OTHER })]

/** A PDF fixture: comment `c1` (the account's, unless `comment` says otherwise) with replies `r1` (the account's) and `r2`, and the PATCH of the comment and of reply `r1` answering `reply`. */
const drive = (comment: Record<string, unknown> = {}, reply: Record<string, unknown> = { json: { id: "c1" } }) =>
  changeFixture([
    FILE,
    answer(COMMENT_URL, driveComment("c1", { author: ME, replies: REPLIES, ...comment })),
    patchTo(COMMENT_URL, reply),
    patchTo(`${COMMENT_URL}/replies/r1`, reply),
  ])

describe("google_comments_edit: a spreadsheet", () => {
  test("sends one updateCommentPost for the thread's first post and returns the old and the new words", async () => {
    const h = await sheets()

    const result = await h.edit({ file: SPREADSHEET_ID, comment_id: THREAD_ID, text: "New words." })

    expect(result).toEqual({
      file_id: SPREADSHEET_ID,
      comment_id: THREAD_ID,
      reply_id: null,
      before: "My old words.",
      text: "New words.",
    })
    expect(h.calls().map(callOf)).toEqual([
      `GET https://www.googleapis.com/drive/v3/files/${SPREADSHEET_ID}`,
      `GET https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`,
      `POST https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`,
    ])
    expect(h.writes()[0]?.json).toEqual({
      requests: [{ updateCommentPost: { commentId: THREAD_ID, postId: `${THREAD_ID}-head`, content: "New words." } }],
    })
  })

  test("a reply is edited by its post id", async () => {
    const h = await sheets()

    const result = await h.edit({ file: SPREADSHEET_ID, comment_id: THREAD_ID, reply_id: "p1", text: "Better." })

    expect(result).toMatchObject({ reply_id: "p1", before: "My reply.", text: "Better." })
    expect(h.writes()[0]?.json).toEqual({
      requests: [{ updateCommentPost: { commentId: THREAD_ID, postId: "p1", content: "Better." } }],
    })
  })

  test("`before` is clipped like the read clips, and the new text is sent whole", async () => {
    const old = "あ".repeat(4001)
    const h = await sheets([sheetsThread(THREAD_ID, { headPost: post("h", { author: ME, content: old }) })])

    const result = await h.edit({ file: SPREADSHEET_ID, comment_id: THREAD_ID, text: "Short." })

    expect(result.before).toBe("あ".repeat(4000))
  })

  test("2049 bytes of UTF-8 are refused, stating the count, and 2048 are not", async () => {
    const h = await sheets()
    const args = { file: SPREADSHEET_ID, comment_id: THREAD_ID }

    await expect(h.edit({ ...args, text: "あ".repeat(683) })).rejects.toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining("2049 bytes"),
    })
    expect(h.writes()).toEqual([])
    await h.edit({ ...args, text: `${"あ".repeat(682)}ab` })
    expect(h.writes()).toHaveLength(1)
  })

  test.each([
    ["a thread Google does not list", { comment_id: "missing" }],
    ["a reply the thread does not have", { comment_id: THREAD_ID, reply_id: "missing" }],
  ])("%s is not_found, before any write", async (_name, args) => {
    const h = await sheets()

    await expect(h.edit({ file: SPREADSHEET_ID, text: "Hi", ...args })).rejects.toMatchObject({ code: "not_found" })
    expect(h.writes()).toEqual([])
  })

  test("a reply that was deleted is not_found", async () => {
    const h = await sheets([
      sheetsThread(THREAD_ID, {
        replies: [post("p1", { author: ME, deleted: true })],
        headPost: post("h", { author: ME }),
      }),
    ])

    await expect(
      h.edit({ file: SPREADSHEET_ID, comment_id: THREAD_ID, reply_id: "p1", text: "Hi" }),
    ).rejects.toMatchObject({ code: "not_found" })
  })

  test.each([
    ["ALL_FAILED_UNKNOWN_REASON", { commentUpdateState: "ALL_FAILED_UNKNOWN_REASON" }],
    ["COMMENT_UPDATE_STATE_UNSPECIFIED", {}],
  ])("the state %s fails the call as upstream_error, naming it", async (state, reply) => {
    const h = await sheets([MINE], reply)

    await expect(h.edit({ file: SPREADSHEET_ID, comment_id: THREAD_ID, text: "Hi" })).rejects.toMatchObject({
      code: "upstream_error",
      message: expect.stringContaining(state),
    })
  })
})

describe("google_comments_edit: another file", () => {
  test("patches the comment with the new words and fields=id", async () => {
    const h = await drive()

    const result = await h.edit({ file: FILE_ID, comment_id: "c1", text: "New words." })

    expect(result).toEqual({
      file_id: FILE_ID,
      comment_id: "c1",
      reply_id: null,
      before: "Please check this paragraph.",
      text: "New words.",
    })
    const [, read, write] = h.calls()
    expect(read?.url.searchParams.get("fields")).toBe(
      "id,author(displayName,me),content,resolved,deleted,replies(id,author(displayName,me),content,deleted,action)",
    )
    expect(callOf(write!)).toBe(`PATCH https://www.googleapis.com/drive/v3/files/${FILE_ID}/comments/c1`)
    expect(write?.json).toEqual({ content: "New words." })
    expect(write?.url.searchParams.get("fields")).toBe("id")
    expect(h.calls()).toHaveLength(3)
  })

  test("patches a reply at its own address", async () => {
    const h = await drive()

    const result = await h.edit({ file: FILE_ID, comment_id: "c1", reply_id: "r1", text: "Done, again." })

    expect(result).toMatchObject({ reply_id: "r1", before: "Done.", text: "Done, again." })
    expect(callOf(h.writes()[0]!)).toBe(
      `PATCH https://www.googleapis.com/drive/v3/files/${FILE_ID}/comments/c1/replies/r1`,
    )
    expect(h.writes()[0]?.json).toEqual({ content: "Done, again." })
  })

  test("the text is limited in characters, not in bytes", async () => {
    const h = await drive()

    await h.edit({ file: FILE_ID, comment_id: "c1", text: "あ".repeat(683) })

    expect(h.writes()).toHaveLength(1)
  })

  test.each([
    ["a deleted comment", { deleted: true }, "c1", undefined],
    ["a reply the comment lacks", {}, "c1", "missing"],
    ["a reply that was deleted", { replies: [driveReply("r1", { author: ME, deleted: true })] }, "c1", "r1"],
  ])("%s is not_found", async (_name, comment, comment_id, reply_id) => {
    const h = await drive(comment)

    await expect(h.edit({ file: FILE_ID, comment_id, reply_id, text: "Hi" })).rejects.toMatchObject({
      code: "not_found",
    })
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

    await expect(h.edit({ file: FILE_ID, comment_id: "c1", text: "Hi" })).rejects.toMatchObject(
      refused("edit the comment"),
    )
    await expect(h.edit({ file: FILE_ID, comment_id: "c1", reply_id: "r1", text: "Hi" })).rejects.toMatchObject(
      refused("edit the reply"),
    )
  })

  test("any other failure passes as it is", async () => {
    const h = await drive({}, refusal(500, "backendError", "Broken."))

    await expect(h.edit({ file: FILE_ID, comment_id: "c1", text: "Hi" })).rejects.toMatchObject({
      code: "upstream_error",
    })
  })
})
