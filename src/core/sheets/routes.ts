import type { Route } from "../google/routes"
import { DRIVE_METADATA_READ_SCOPE, SHEETS_READ_SCOPE, SHEETS_WRITE_SCOPE } from "./scopes"

const DRIVE_HOST = "www.googleapis.com"
const SHEETS_HOST = "sheets.googleapis.com"

/** Drive scopes beyond the metadata one that also list files. */
const DRIVE_READ_SCOPE = "https://www.googleapis.com/auth/drive.readonly"
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive"

/** The calls the Sheets tools may make, each with every scope that allows it. */
export const SHEETS_ROUTES = {
  files: {
    method: "GET",
    host: DRIVE_HOST,
    path: "/drive/v3/files",
    scopes: [DRIVE_METADATA_READ_SCOPE, DRIVE_READ_SCOPE, DRIVE_SCOPE],
  },
  spreadsheet: {
    method: "GET",
    host: SHEETS_HOST,
    path: "/v4/spreadsheets/{spreadsheet_id}",
    scopes: [SHEETS_READ_SCOPE, SHEETS_WRITE_SCOPE],
  },
  batchGet: {
    method: "GET",
    host: SHEETS_HOST,
    path: "/v4/spreadsheets/{spreadsheet_id}/values:batchGet",
    scopes: [SHEETS_READ_SCOPE, SHEETS_WRITE_SCOPE],
  },
} as const satisfies Record<string, Route>
