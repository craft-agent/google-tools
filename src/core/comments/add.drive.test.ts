import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { DOCUMENT_MIME_TYPE } from "../drive/kinds"
import {
  FILE_ID,
  addFixture,
  answer,
  callOf,
  cleanUp,
  commentsUrl,
  driveComment,
  driveFile,
  fileUrl,
  freshTokens,
  postTo,
  refusal,
  respond,
} from "./add.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const COMMENT_URL = `${commentsUrl(FILE_ID)}/c1`
const REPLIES_URL = `${COMMENT_URL}/replies`

const FILE = answer(fileUrl(FILE_ID), driveFile(FILE_ID, { name: "Notes.pdf" }))
const THREAD = answer(COMMENT_URL, driveComment("c1"))
const CREATE = postTo(commentsUrl(FILE_ID), { json: { id: "c-new" } })
const REPLY = postTo(REPLIES_URL, { json: { id: "r-new" } })

describe("google_comments_add: a new comment on a Drive file", () => {
  test("posts the words with fields=id and returns the comment's id, with no cell and no assignee", async () => {
    const h = await addFixture([FILE, CREATE])

    const result = await h.add({ file: FILE_ID, text: "Looks right." })

    expect(result).toEqual({
      file_id: FILE_ID,
      comment_id: "c-new",
      reply_id: null,
      at: null,
      assignee: null,
      emailed: [],
    })
    expect(h.calls().map(callOf)).toEqual([
      `GET https://www.googleapis.com/drive/v3/files/${FILE_ID}`,
      `POST https://www.googleapis.com/drive/v3/files/${FILE_ID}/comments`,
    ])
    expect(h.writes()[0]?.json).toEqual({ content: "Looks right." })
    expect(h.writes()[0]?.url.searchParams.get("fields")).toBe("id")
  })

  test("a mentioned address is emailed and returned", async () => {
    const h = await addFixture([FILE, CREATE])

    const result = await h.add({ file: FILE_ID, text: "Can you check, +Bob@Example.test?" })

    expect(result.emailed).toEqual(["bob@example.test"])
    expect(h.writes()[0]?.json).toEqual({ content: "Can you check, +Bob@Example.test?" })
  })

  test("a Google Doc takes a comment the same way", async () => {
    const doc = answer(fileUrl(FILE_ID), driveFile(FILE_ID, { mimeType: DOCUMENT_MIME_TYPE }))
    const h = await addFixture([doc, CREATE])

    expect((await h.add({ file: FILE_ID, text: "Hi" })).comment_id).toBe("c-new")
  })

  test("a comment Google answers with no id is empty, and is not failed for it", async () => {
    const h = await addFixture([FILE, postTo(commentsUrl(FILE_ID), { json: {} })])

    expect((await h.add({ file: FILE_ID, text: "Hi" })).comment_id).toBe("")
  })
})

describe("google_comments_add: a reply on a Drive file", () => {
  test("reads the comment, then posts the words to its replies with fields=id, and returns both ids", async () => {
    const h = await addFixture([FILE, THREAD, REPLY])

    const result = await h.add({ file: FILE_ID, comment_id: "c1", text: "Done." })

    expect(result).toEqual({
      file_id: FILE_ID,
      comment_id: "c1",
      reply_id: "r-new",
      at: null,
      assignee: null,
      emailed: [],
    })
    const [, read, write] = h.calls()
    expect(read?.url.searchParams.get("fields")).toBe("id,author(displayName,me),content,resolved,deleted")
    expect(callOf(write!)).toBe(`POST https://www.googleapis.com/drive/v3/files/${FILE_ID}/comments/c1/replies`)
    expect(write?.json).toEqual({ content: "Done." })
    expect(write?.url.searchParams.get("fields")).toBe("id")
    expect(h.calls()).toHaveLength(3)
  })

  test("a resolved comment still takes a reply", async () => {
    const resolved = answer(COMMENT_URL, driveComment("c1", { resolved: true }))
    const h = await addFixture([FILE, resolved, REPLY])

    expect((await h.add({ file: FILE_ID, comment_id: "c1", text: "Thanks." })).reply_id).toBe("r-new")
  })

  test.each([
    ["deleted", [FILE, answer(COMMENT_URL, driveComment("c1", { deleted: true })), REPLY]],
    ["unknown to Google", [FILE, respond(COMMENT_URL, refusal(404, "notFound", "Comment not found.")), REPLY]],
  ])("a comment that is %s is not_found, before any write", async (_name, handlers) => {
    const h = await addFixture(handlers)

    await expect(h.add({ file: FILE_ID, comment_id: "c1", text: "Done." })).rejects.toMatchObject({
      code: "not_found",
    })
    expect(h.writes()).toEqual([])
  })
})

describe("google_comments_add: what Google refuses on a Drive file", () => {
  const REFUSED =
    "Google refused the comment: these tools can comment only on spreadsheets and on the files they created (drive.file), and nothing was added."

  test.each([
    ["a 403", 403, "forbidden"],
    ["a 404", 404, "notFound"],
  ])("%s on a new comment is the forbidden refusal", async (_name, status, reason) => {
    const h = await addFixture([FILE, respondPost(commentsUrl(FILE_ID), status, reason)])

    await expect(h.add({ file: FILE_ID, text: "Hi" })).rejects.toMatchObject({
      code: "forbidden",
      message: REFUSED,
      details: { status },
    })
  })

  test.each([
    ["a 403", 403, "forbidden"],
    ["a 404", 404, "notFound"],
  ])("%s on a reply is the forbidden refusal", async (_name, status, reason) => {
    const h = await addFixture([FILE, THREAD, respondPost(REPLIES_URL, status, reason)])

    await expect(h.add({ file: FILE_ID, comment_id: "c1", text: "Hi" })).rejects.toMatchObject({
      code: "forbidden",
      message: REFUSED,
    })
  })

  test("a rate limit is not turned into a refusal", async () => {
    const h = await addFixture([FILE, respondPost(commentsUrl(FILE_ID), 429, "rateLimitExceeded")])

    await expect(h.add({ file: FILE_ID, text: "Hi" })).rejects.toMatchObject({ code: "rate_limited" })
  })

  test("any other failure passes as it is", async () => {
    const h = await addFixture([FILE, respondPost(commentsUrl(FILE_ID), 500, "backendError")])

    await expect(h.add({ file: FILE_ID, text: "Hi" })).rejects.toMatchObject({ code: "upstream_error" })
  })
})

/** A POST handler that answers `status` with an error of `reason`. */
function respondPost(url: string, status: number, reason: string) {
  return postTo(url, refusal(status, reason, "Refused."))
}
