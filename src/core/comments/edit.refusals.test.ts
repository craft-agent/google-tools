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
  saved,
  sheetsHandlers,
  sheetsTab,
  sheetsThread,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const TABS = [sheetsTab(7, "Plan", [[ANCHOR_ID, CELL_B2]])]

const COMMENT_URL = `${commentsUrl(FILE_ID)}/c1`

/** A spreadsheet thread written by `head`, with a reply `p1` written by `reply`, both given as authors. */
const sheets = (head: unknown, reply: unknown = ME, headContent = "Old words.") =>
  changeFixture([
    postTo(BATCH_UPDATE_URL, { json: saved() }),
    ...sheetsHandlers(
      [
        sheetsThread(THREAD_ID, {
          headPost: post("h", { author: head, content: headContent }),
          replies: [post("p1", { author: reply, content: "Reply words." })],
        }),
      ],
      TABS,
    ),
  ])

/** A PDF fixture whose comment `c1` and reply `r1` were written by the authors given. */
const drive = (comment: unknown, reply: unknown = ME) =>
  changeFixture([
    answer(fileUrl(FILE_ID), driveFile(FILE_ID)),
    answer(COMMENT_URL, driveComment("c1", { author: comment, replies: [driveReply("r1", { author: reply })] })),
    patchTo(COMMENT_URL, { json: { id: "c1" } }),
    patchTo(`${COMMENT_URL}/replies/r1`, { json: { id: "r1" } }),
  ])

describe("google_comments_edit: only the author edits", () => {
  const SOMEONE = (name: string) => `Only the author can edit a post; this one was written by ${name}.`

  test("another person's first post, or reply, is forbidden, naming the author, before any write", async () => {
    const h = await sheets(OTHER, OTHER)
    const args = { file: SPREADSHEET_ID, comment_id: THREAD_ID, text: "Mine now." }

    await expect(h.edit(args)).rejects.toMatchObject({ code: "forbidden", message: SOMEONE("Ann Example") })
    await expect(h.edit({ ...args, reply_id: "p1" })).rejects.toMatchObject({ code: "forbidden" })
    expect(h.writes()).toEqual([])
  })

  test("the account's reply under another person's comment is editable, and the reverse is not", async () => {
    const h = await sheets(OTHER, ME)
    await h.edit({ file: SPREADSHEET_ID, comment_id: THREAD_ID, reply_id: "p1", text: "Fixed." })
    expect(h.writes()).toHaveLength(1)

    const reverse = await sheets(ME, OTHER)
    await expect(
      reverse.edit({ file: SPREADSHEET_ID, comment_id: THREAD_ID, reply_id: "p1", text: "Hi" }),
    ).rejects.toMatchObject({ code: "forbidden" })
    expect(reverse.writes()).toEqual([])
  })

  test("an author Google does not name is `someone else`", async () => {
    const h = await sheets({ me: false })

    await expect(h.edit({ file: SPREADSHEET_ID, comment_id: THREAD_ID, text: "Hi" })).rejects.toMatchObject({
      message: SOMEONE("someone else"),
    })
  })

  test("is the same on another file, for the comment and for a reply", async () => {
    const h = await drive(OTHER, OTHER)

    await expect(h.edit({ file: FILE_ID, comment_id: "c1", text: "Hi" })).rejects.toMatchObject({ code: "forbidden" })
    await expect(h.edit({ file: FILE_ID, comment_id: "c1", reply_id: "r1", text: "Hi" })).rejects.toMatchObject({
      code: "forbidden",
    })
    expect(h.writes()).toEqual([])
  })
})

describe("google_comments_edit: an edit emails nobody", () => {
  test("an address the old text did not mention is refused, naming it and pointing to a reply", async () => {
    const h = await sheets(ME)

    await expect(
      h.edit({ file: SPREADSHEET_ID, comment_id: THREAD_ID, text: "Cc +Bob@Example.test, @cy@example.test" }),
    ).rejects.toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining("bob@example.test, cy@example.test"),
    })
    await expect(
      h.edit({ file: SPREADSHEET_ID, comment_id: THREAD_ID, text: "+bob@example.test" }),
    ).rejects.toMatchObject({ message: expect.stringContaining("add a reply") })
    expect(h.writes()).toEqual([])
  })

  test("an address the old text mentioned already, or one only written out, is not new", async () => {
    const h = await sheets(ME, ME, "Cc +bob@example.test please")

    await h.edit({
      file: SPREADSHEET_ID,
      comment_id: THREAD_ID,
      text: "Cc +BOB@example.test, thanks; ann@example.test",
    })

    expect(h.writes()).toHaveLength(1)
  })

  test("is the same on another file", async () => {
    const h = await drive(ME)

    await expect(h.edit({ file: FILE_ID, comment_id: "c1", text: "+bob@example.test" })).rejects.toMatchObject({
      code: "invalid_argument",
    })
    expect(h.writes()).toEqual([])
  })
})

describe("google_comments_edit: the arguments", () => {
  test.each([
    ["no text", { text: "" }],
    ["a text of 2049 characters", { text: "a".repeat(2049) }],
    ["no comment id", { comment_id: "" }],
    ["an empty reply id", { reply_id: "" }],
    ["a reply id that is a path", { reply_id: "../p1" }],
    ["a comment id that is a path", { comment_id: "a/b" }],
    ["an argument no call has", { status: "open" }],
  ])("%s is invalid_argument, and sends nothing", async (_name, extra) => {
    const h = await sheets(ME)

    await expect(h.edit({ file: SPREADSHEET_ID, comment_id: THREAD_ID, text: "Hi", ...extra })).rejects.toMatchObject({
      code: "invalid_argument",
    })
    expect(h.requests).toEqual([])
  })
})
