import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { DRIVE_READ_SCOPE } from "../drive/scopes"
import { DOCUMENT_MIME_TYPE, FOLDER_MIME_TYPE, SHORTCUT_MIME_TYPE } from "../drive/kinds"
import { CREDENTIAL, toolError } from "../google/client.fixtures"
import { SHEETS_CREDENTIAL } from "../sheets/read.testing"
import {
  FILE_ID,
  FOLDER_ID,
  SPREADSHEET_ID,
  answer,
  cleanUp,
  commentsUrl,
  driveFile,
  driveFolder,
  fileUrl,
  fixture,
  freshTokens,
  refusal,
  respond,
} from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const NO_COMMENTS = answer(commentsUrl(FILE_ID), { comments: [] })

describe("google_comments_read: files that have no comments to read", () => {
  test("a folder is refused after the file read, before any comment call", async () => {
    const h = await fixture([answer(fileUrl(FOLDER_ID), driveFolder(FOLDER_ID)), NO_COMMENTS])

    await expect(h.read({ file: FOLDER_ID })).rejects.toMatchObject({
      code: "invalid_argument",
      message: "A folder takes no comments.",
    })
    expect(h.calls().map((call) => call.url.pathname)).toEqual([`/drive/v3/files/${FOLDER_ID}`])
  })

  test("a shortcut is refused naming its target, before any comment call", async () => {
    const shortcut = driveFile(FILE_ID, {
      mimeType: SHORTCUT_MIME_TYPE,
      shortcutDetails: { targetId: SPREADSHEET_ID, targetMimeType: "application/pdf" },
    })
    const h = await fixture([answer(fileUrl(FILE_ID), shortcut), NO_COMMENTS])

    await expect(h.read({ file: FILE_ID })).rejects.toMatchObject({
      code: "invalid_argument",
      message: `A shortcut has no comments of its own; read the comments of its target, ${SPREADSHEET_ID}.`,
    })
    expect(h.calls()).toHaveLength(1)
  })

  test.each([
    ["a PDF", driveFile(FILE_ID)],
    ["a Google Doc", driveFile(FILE_ID, { mimeType: DOCUMENT_MIME_TYPE })],
  ])("`ranges` for %s is refused after the file read, before any comment call", async (_name, file) => {
    const h = await fixture([answer(fileUrl(FILE_ID), file), NO_COMMENTS])

    await expect(h.read({ file: FILE_ID, ranges: ["Plan!A1"] })).rejects.toMatchObject({
      code: "invalid_argument",
      message: "`ranges` apply to a spreadsheet only; this file is not one.",
    })
    expect(h.calls()).toHaveLength(1)
  })
})

describe("google_comments_read: the file argument", () => {
  test.each([
    ["a path", "../files"],
    ["a slash", "abc/def"],
    ["a space", "abc def"],
    ["a query", "abc?fields=*"],
    ["an empty value", ""],
    ["an id of 201 characters", "a".repeat(201)],
    ["the alias root", "root"],
    ["a URL of another host", `https://example.test/document/d/${FILE_ID}/edit`],
    ["a plain-http URL", `http://docs.google.com/document/d/${FILE_ID}/edit`],
    ["a URL of another kind of file", `https://docs.google.com/unknown/d/${FILE_ID}/edit`],
    ["a URL with text glued to the id", `https://docs.google.com/document/d/${FILE_ID}x.y`],
    ["a folder URL", `https://drive.google.com/drive/folders/${FOLDER_ID}`],
  ])("%s is invalid_argument, and sends nothing", async (_name, file) => {
    const h = await fixture([answer(fileUrl(FILE_ID), driveFile(FILE_ID)), NO_COMMENTS])

    await expect(h.read({ file })).rejects.toMatchObject({ code: "invalid_argument" })
    expect(h.requests).toEqual([])
  })

  test("a refused value is repeated clipped to 100 characters", async () => {
    const h = await fixture([])

    const error = await toolError(h.read({ file: `x/${"y".repeat(300)}` }))

    expect(error.message).toBe(`"x/${"y".repeat(98)}…" is neither a file id nor a Google file URL.`)
  })

  test.each([
    ["a Docs URL", `https://docs.google.com/document/d/${FILE_ID}/edit?tab=t.0#heading=h.1`],
    ["a Sheets URL", `https://docs.google.com/spreadsheets/d/${FILE_ID}/edit#gid=0`],
    ["a Slides URL", `https://docs.google.com/presentation/d/${FILE_ID}`],
    ["a Drawings URL", `https://docs.google.com/drawings/d/${FILE_ID}/edit`],
    ["a Forms URL", `https://docs.google.com/forms/d/${FILE_ID}/edit?usp=sharing`],
    ["a Drive file URL", `https://drive.google.com/file/d/${FILE_ID}/view?usp=sharing`],
    ["a bare id", FILE_ID],
  ])("%s names the file", async (_name, file) => {
    const h = await fixture([answer(fileUrl(FILE_ID), driveFile(FILE_ID)), NO_COMMENTS])

    expect((await h.read({ file })).file_id).toBe(FILE_ID)
    expect(h.calls()[0]?.url.pathname).toBe(`/drive/v3/files/${FILE_ID}`)
  })

  test("an argument no call has, and a limit or ranges out of range, are refused", async () => {
    const h = await fixture([])

    await expect(h.read({ file: FILE_ID, method: "list" })).rejects.toMatchObject({ code: "invalid_argument" })
    await expect(h.read({ file: FILE_ID, limit: 0 })).rejects.toMatchObject({ code: "invalid_argument" })
    await expect(h.read({ file: FILE_ID, limit: 201 })).rejects.toMatchObject({ code: "invalid_argument" })
    await expect(h.read({ file: FILE_ID, ranges: [] })).rejects.toMatchObject({ code: "invalid_argument" })
    await expect(h.read({ file: FILE_ID, ranges: Array(101).fill("A1") })).rejects.toMatchObject({
      code: "invalid_argument",
    })
    await expect(h.read({})).rejects.toMatchObject({ code: "invalid_argument" })
    expect(h.requests).toEqual([])
  })
})

describe("google_comments_read: the label's scopes", () => {
  test("a label logged in for account only fails with the fix naming comments, before any request", async () => {
    const h = await fixture([], CREDENTIAL)

    const error = await toolError(h.read({ file: FILE_ID }))

    expect(error).toMatchObject({ code: "unauthenticated" })
    expect(error.message).toContain("login --account work --toolsets account,comments")
    expect(error.message).not.toContain("--read-only")
    expect(error.details?.needs).toEqual([DRIVE_READ_SCOPE])
    expect(h.requests).toEqual([])
  })

  test("the Sheets scopes, which reach only the names of files, do not read comments", async () => {
    const h = await fixture([answer(fileUrl(FILE_ID), driveFile(FILE_ID))], SHEETS_CREDENTIAL)

    await expect(h.read({ file: FILE_ID })).rejects.toMatchObject({ code: "unauthenticated" })
    expect(h.requests).toEqual([])
  })

  test("a label with drive.readonly alone reads the file, but no spreadsheet's comments, and names the fix", async () => {
    const spreadsheet = driveFile(SPREADSHEET_ID, { mimeType: "application/vnd.google-apps.spreadsheet" })
    const h = await fixture([answer(fileUrl(SPREADSHEET_ID), spreadsheet)], {
      ...CREDENTIAL,
      scopes: [...CREDENTIAL.scopes, DRIVE_READ_SCOPE],
    })

    const error = await toolError(h.read({ file: SPREADSHEET_ID }))

    expect(error.code).toBe("unauthenticated")
    expect(error.message).toContain("comments")
    expect(h.calls()).toHaveLength(1)
  })
})

describe("google_comments_read: Google's refusals", () => {
  test("a file that does not exist is not_found", async () => {
    const h = await fixture([respond(fileUrl(FILE_ID), refusal(404, "notFound", "File not found: x."))])

    await expect(h.read({ file: FILE_ID })).rejects.toMatchObject({
      code: "not_found",
      message: expect.stringContaining("File not found: x."),
    })
  })

  test("a file whose comments Google refuses is forbidden", async () => {
    const h = await fixture([
      answer(fileUrl(FILE_ID), driveFile(FILE_ID)),
      respond(commentsUrl(FILE_ID), refusal(403, "forbidden", "The user does not have sufficient permissions.")),
    ])

    await expect(h.read({ file: FILE_ID })).rejects.toMatchObject({ code: "forbidden" })
  })

  test("a reply that is not a comment list is upstream_error", async () => {
    const h = await fixture([
      answer(fileUrl(FILE_ID), driveFile(FILE_ID)),
      answer(commentsUrl(FILE_ID), { comments: [{}] }),
    ])

    await expect(h.read({ file: FILE_ID })).rejects.toMatchObject({
      code: "upstream_error",
      message: "Google's reply to the comment list was not in the expected shape.",
    })
  })
})
