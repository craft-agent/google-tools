import { describe, expect, test } from "bun:test"
import { HOSTS, routeUrl } from "../google/routes"
import { SHEETS_ROUTES } from "./routes"
import { DRIVE_METADATA_READ_SCOPE, SHEETS_READ_SCOPE, SHEETS_WRITE_SCOPE } from "./scopes"

describe("SHEETS_ROUTES", () => {
  test("every route sits on an allowed host", () => {
    for (const route of Object.values(SHEETS_ROUTES)) expect(HOSTS).toContain(route.host)
  })

  test("the reads are GETs and the writes POSTs that only the write scope allows", () => {
    const writes = [
      SHEETS_ROUTES.update,
      SHEETS_ROUTES.clear,
      SHEETS_ROUTES.append,
      SHEETS_ROUTES.create,
      SHEETS_ROUTES.batchUpdate,
    ]
    for (const route of [SHEETS_ROUTES.files, SHEETS_ROUTES.spreadsheet, SHEETS_ROUTES.batchGet]) {
      expect(route.method).toBe("GET")
    }
    for (const route of writes) {
      expect(route.method).toBe("POST")
      expect(route.scopes).toEqual([SHEETS_WRITE_SCOPE])
    }
  })

  test("the list route takes any Drive scope that reads metadata, the spreadsheet routes either Sheets scope", () => {
    expect(SHEETS_ROUTES.files.scopes).toEqual([
      DRIVE_METADATA_READ_SCOPE,
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive",
    ])
    expect(SHEETS_ROUTES.spreadsheet.scopes).toEqual([SHEETS_READ_SCOPE, SHEETS_WRITE_SCOPE])
    expect(SHEETS_ROUTES.batchGet.scopes).toEqual([SHEETS_READ_SCOPE, SHEETS_WRITE_SCOPE])
  })

  test("the URLs keep the literal :batchGet and encode the id", () => {
    expect(routeUrl(SHEETS_ROUTES.files).toString()).toBe("https://www.googleapis.com/drive/v3/files")
    expect(routeUrl(SHEETS_ROUTES.spreadsheet, { spreadsheet_id: "abc_DEF-123" }).toString()).toBe(
      "https://sheets.googleapis.com/v4/spreadsheets/abc_DEF-123",
    )
    const url = routeUrl(SHEETS_ROUTES.batchGet, { spreadsheet_id: "abc_DEF-123" }, { ranges: ["A1:B2", "Tab!C:C"] })
    expect(url.pathname).toBe("/v4/spreadsheets/abc_DEF-123/values:batchGet")
    expect(url.searchParams.getAll("ranges")).toEqual(["A1:B2", "Tab!C:C"])
  })

  test("the write URLs keep their literal verbs and encode a range", () => {
    const params = { spreadsheet_id: "abc_DEF-123" }
    expect(routeUrl(SHEETS_ROUTES.update, params).pathname).toBe("/v4/spreadsheets/abc_DEF-123/values:batchUpdate")
    expect(routeUrl(SHEETS_ROUTES.clear, params).pathname).toBe("/v4/spreadsheets/abc_DEF-123/values:batchClear")
    expect(routeUrl(SHEETS_ROUTES.batchUpdate, params).pathname).toBe("/v4/spreadsheets/abc_DEF-123:batchUpdate")
    const append = routeUrl(SHEETS_ROUTES.append, { ...params, range: "'My Tab'!A1:C" })
    expect(append.pathname).toBe("/v4/spreadsheets/abc_DEF-123/values/'My%20Tab'!A1%3AC:append")
  })

  test("a tab title with a slash cannot be a path parameter", () => {
    expect(() => routeUrl(SHEETS_ROUTES.append, { spreadsheet_id: "abc_DEF-123", range: "'a/b'!A1" })).toThrow()
  })
})
