import { describe, expect, test } from "bun:test"
import { DRIVE_FILE_SCOPE, DRIVE_READ_SCOPE } from "../drive/scopes"
import { HOSTS, routeUrl } from "../google/routes"
import { SHEETS_READ_SCOPE, SHEETS_WRITE_SCOPE } from "../sheets/scopes"
import { COMMENTS_ROUTES } from "./routes"

describe("COMMENTS_ROUTES", () => {
  test("every route is on a host the package may reach", () => {
    for (const route of Object.values(COMMENTS_ROUTES)) expect(HOSTS).toContain(route.host)
  })

  test("the reads are GETs on read scopes, and the writes are exactly the listed POSTs, PATCHes and DELETEs", () => {
    const reads = [COMMENTS_ROUTES.file, COMMENTS_ROUTES.comments, COMMENTS_ROUTES.spreadsheet, COMMENTS_ROUTES.comment]
    for (const route of reads) expect(route.method).toBe("GET")
    const writes = Object.entries(COMMENTS_ROUTES)
      .filter(([, route]) => route.method !== "GET")
      .map(([name, route]) => [name, route.method])
    expect(writes).toEqual([
      ["commentCreate", "POST"],
      ["replyCreate", "POST"],
      ["batchUpdate", "POST"],
      ["commentUpdate", "PATCH"],
      ["replyUpdate", "PATCH"],
      ["commentDelete", "DELETE"],
      ["replyDelete", "DELETE"],
    ])
  })

  test("the Drive reads take drive.readonly, the spreadsheet read the Sheets scopes, narrowest first", () => {
    expect(COMMENTS_ROUTES.file.scopes).toEqual([DRIVE_READ_SCOPE])
    expect(COMMENTS_ROUTES.comments.scopes).toEqual([DRIVE_READ_SCOPE])
    expect(COMMENTS_ROUTES.comment.scopes).toEqual([DRIVE_READ_SCOPE])
    expect(COMMENTS_ROUTES.spreadsheet.scopes).toEqual([SHEETS_READ_SCOPE, SHEETS_WRITE_SCOPE])
  })

  test("the writes take drive.file for a Drive file and the Sheets write scope for a spreadsheet", () => {
    expect(COMMENTS_ROUTES.commentCreate.scopes).toEqual([DRIVE_FILE_SCOPE])
    expect(COMMENTS_ROUTES.replyCreate.scopes).toEqual([DRIVE_FILE_SCOPE])
    expect(COMMENTS_ROUTES.batchUpdate.scopes).toEqual([SHEETS_WRITE_SCOPE])
    for (const route of [
      COMMENTS_ROUTES.commentUpdate,
      COMMENTS_ROUTES.replyUpdate,
      COMMENTS_ROUTES.commentDelete,
      COMMENTS_ROUTES.replyDelete,
    ]) {
      expect(route.scopes).toEqual([DRIVE_FILE_SCOPE])
    }
  })

  test("the URLs, the ids encoded", () => {
    expect(routeUrl(COMMENTS_ROUTES.file, { file_id: "a_B-1" }).toString()).toBe(
      "https://www.googleapis.com/drive/v3/files/a_B-1",
    )
    expect(routeUrl(COMMENTS_ROUTES.comments, { file_id: "a_B-1" }).toString()).toBe(
      "https://www.googleapis.com/drive/v3/files/a_B-1/comments",
    )
    expect(routeUrl(COMMENTS_ROUTES.spreadsheet, { spreadsheet_id: "a_B-1" }).toString()).toBe(
      "https://sheets.googleapis.com/v4/spreadsheets/a_B-1",
    )
    expect(routeUrl(COMMENTS_ROUTES.comments, { file_id: "a b" }).pathname).toBe("/drive/v3/files/a%20b/comments")
    expect(routeUrl(COMMENTS_ROUTES.comment, { file_id: "f", comment_id: "c-1" }).toString()).toBe(
      "https://www.googleapis.com/drive/v3/files/f/comments/c-1",
    )
    expect(routeUrl(COMMENTS_ROUTES.replyCreate, { file_id: "f", comment_id: "c-1" }).pathname).toBe(
      "/drive/v3/files/f/comments/c-1/replies",
    )
    expect(routeUrl(COMMENTS_ROUTES.replyUpdate, { file_id: "f", comment_id: "c-1", reply_id: "r.2" }).pathname).toBe(
      "/drive/v3/files/f/comments/c-1/replies/r.2",
    )
    expect(routeUrl(COMMENTS_ROUTES.commentDelete, { file_id: "f", comment_id: "c-1" }).pathname).toBe(
      "/drive/v3/files/f/comments/c-1",
    )
    expect(routeUrl(COMMENTS_ROUTES.batchUpdate, { spreadsheet_id: "a_B-1" }).toString()).toBe(
      "https://sheets.googleapis.com/v4/spreadsheets/a_B-1:batchUpdate",
    )
  })

  test("an id with a slash or a dot segment cannot be a path parameter", () => {
    expect(() => routeUrl(COMMENTS_ROUTES.file, { file_id: "a/b" })).toThrow()
    expect(() => routeUrl(COMMENTS_ROUTES.comments, { file_id: ".." })).toThrow()
    expect(() => routeUrl(COMMENTS_ROUTES.spreadsheet, { spreadsheet_id: "a/b" })).toThrow()
  })
})
