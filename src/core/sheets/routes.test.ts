import { describe, expect, test } from "bun:test"
import { HOSTS, routeUrl } from "../google/routes"
import { SHEETS_ROUTES } from "./routes"
import { DRIVE_METADATA_READ_SCOPE, SHEETS_READ_SCOPE, SHEETS_WRITE_SCOPE } from "./scopes"

describe("SHEETS_ROUTES", () => {
  test("every route sits on an allowed host and is a GET", () => {
    for (const route of Object.values(SHEETS_ROUTES)) {
      expect(HOSTS).toContain(route.host)
      expect(route.method).toBe("GET")
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
})
