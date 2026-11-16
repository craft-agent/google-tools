import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import {
  FILES_URL,
  FILE_ID,
  FOLDER_ID,
  SHARED_DRIVE_ID,
  answer,
  cleanUp,
  driveFile,
  fixture,
  freshTokens,
} from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

/** A fixture whose Drive lists `files` and the list fields given. */
const listing = (files: unknown[] = [], list: Record<string, unknown> = {}) =>
  fixture([answer(FILES_URL, { files, ...list })])

/** The query a search sent to Drive, as a plain object. */
async function sent(args: Record<string, unknown>) {
  const h = await listing()
  await h.read({ method: "search", ...args })
  return Object.fromEntries(h.calls()[0]!.url.searchParams)
}

describe("google_drive_read search", () => {
  test("lists the files as views, with the paging fields", async () => {
    const h = await listing([driveFile(FILE_ID)], { nextPageToken: "next-1", incompleteSearch: true })

    const result = await h.read({ method: "search" })

    expect(result).toEqual({
      files: [
        {
          file_id: FILE_ID,
          name: "Budget 2026.pdf",
          mime_type: "application/pdf",
          kind: "file",
          size: 2048,
          modified_time: "2026-05-30T08:00:00.000Z",
          created_time: "2026-05-01T09:30:00.000Z",
          parents: [FOLDER_ID],
          drive_id: null,
          owners: ["someone@example.test"],
          shared: false,
          trashed: false,
          web_view_link: `https://drive.google.com/file/d/${FILE_ID}/view`,
          starred: false,
        },
      ],
      next_page_token: "next-1",
      incomplete_search: true,
    })
  })

  test("a list with nothing in it is no files, no next page and a complete search", async () => {
    const h = await listing([], {})

    expect(await h.read({ method: "search" })).toEqual({ files: [], next_page_token: null, incomplete_search: false })
  })

  test("asks for every drive, the file fields and the newest change first, 20 at a time, trashed files left out", async () => {
    const query = await sent({})

    expect(query).toMatchObject({
      q: "trashed = false",
      corpora: "allDrives",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      orderBy: "modifiedTime desc",
      pageSize: "20",
    })
    expect(query.fields).toStartWith("nextPageToken,incompleteSearch,files(id,name,mimeType,size,")
    expect(query.pageToken).toBeUndefined()
  })

  test("sends the limit and the page token", async () => {
    expect(await sent({ limit: 100, page_token: "tok-2" })).toMatchObject({ pageSize: "100", pageToken: "tok-2" })
  })

  test("`query` is a full-text condition, escaped, and the results are not sorted", async () => {
    const query = await sent({ query: `it's a \\ "test"` })

    expect(query.q).toBe(`fullText contains 'it\\'s a \\\\ "test"' and trashed = false`)
    expect(query.orderBy).toBeUndefined()
  })

  test("`folder` and `mime_type` join the conditions, the type escaped", async () => {
    const query = await sent({ folder: FOLDER_ID, mime_type: "application/x-o'brien" })

    expect(query.q).toBe(`'${FOLDER_ID}' in parents and mimeType = 'application/x-o\\'brien' and trashed = false`)
    expect(query.orderBy).toBe("modifiedTime desc")
  })

  test("`folder` takes the alias root", async () => {
    expect((await sent({ folder: "root" })).q).toBe("'root' in parents and trashed = false")
  })

  test.each([
    [true, "trashed = true"],
    [false, "trashed = false"],
  ])("trashed %p is `%s`", async (trashed, clause) => {
    expect((await sent({ trashed })).q).toBe(clause)
  })

  test("`drive_id` searches that shared drive alone", async () => {
    expect(await sent({ drive_id: SHARED_DRIVE_ID })).toMatchObject({
      corpora: "drive",
      driveId: SHARED_DRIVE_ID,
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    })
    expect((await sent({})).driveId).toBeUndefined()
  })
})

describe("google_drive_read search with raw_query", () => {
  test("is passed as written, with trashed files included", async () => {
    const query = await sent({ raw_query: "name contains 'plan' or starred = true" })

    expect(query.q).toBe("name contains 'plan' or starred = true")
    expect(query.orderBy).toBe("modifiedTime desc")
  })

  test("is wrapped when other conditions join it, `trashed` only when given", async () => {
    const query = await sent({ raw_query: "name contains 'a' or name contains 'b'", folder: FOLDER_ID, trashed: false })

    expect(query.q).toBe(`(name contains 'a' or name contains 'b') and '${FOLDER_ID}' in parents and trashed = false`)
  })

  test("that holds fullText is not sorted", async () => {
    expect((await sent({ raw_query: "fullText contains 'x'" })).orderBy).toBeUndefined()
  })

  test("is refused together with `query`, and nothing is sent", async () => {
    const h = await listing()

    const error = await toolError(h.read({ method: "search", query: "a", raw_query: "name = 'b'" }))

    expect(error).toMatchObject({ code: "invalid_argument", message: "Give `query` or `raw_query`, not both." })
    expect(h.requests).toEqual([])
  })
})
