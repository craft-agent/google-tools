import { describe, expect, test } from "bun:test"
import { DRIVE_READ_SCOPE } from "../drive/scopes"
import { HOSTS, routeUrl } from "../google/routes"
import { SHEETS_READ_SCOPE, SHEETS_WRITE_SCOPE } from "../sheets/scopes"
import { COMMENTS_ROUTES } from "./routes"

describe("COMMENTS_ROUTES", () => {
  test("every route is a GET on a host the package may reach", () => {
    for (const route of Object.values(COMMENTS_ROUTES)) {
      expect(HOSTS).toContain(route.host)
      expect(route.method).toBe("GET")
    }
  })

  test("the Drive routes take drive.readonly, the spreadsheet route the Sheets scopes, narrowest first", () => {
    expect(COMMENTS_ROUTES.file.scopes).toEqual([DRIVE_READ_SCOPE])
    expect(COMMENTS_ROUTES.comments.scopes).toEqual([DRIVE_READ_SCOPE])
    expect(COMMENTS_ROUTES.spreadsheet.scopes).toEqual([SHEETS_READ_SCOPE, SHEETS_WRITE_SCOPE])
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
  })

  test("an id with a slash or a dot segment cannot be a path parameter", () => {
    expect(() => routeUrl(COMMENTS_ROUTES.file, { file_id: "a/b" })).toThrow()
    expect(() => routeUrl(COMMENTS_ROUTES.comments, { file_id: ".." })).toThrow()
    expect(() => routeUrl(COMMENTS_ROUTES.spreadsheet, { spreadsheet_id: "a/b" })).toThrow()
  })
})
