import { DRIVE_FILE_SCOPE, DRIVE_READ_SCOPE } from "../drive/scopes"
import type { Route } from "../google/routes"
import { SHEETS_READ_SCOPE, SHEETS_WRITE_SCOPE } from "../sheets/scopes"

const DRIVE_HOST = "www.googleapis.com"

const SHEETS_HOST = "sheets.googleapis.com"

const FILES_PATH = "/drive/v3/files"

/** The calls the comment tools may make, each with every scope that allows it, narrowest first. */
export const COMMENTS_ROUTES = {
  /** `files.get`: which kind of file the comments belong to. */
  file: { method: "GET", host: DRIVE_HOST, path: `${FILES_PATH}/{file_id}`, scopes: [DRIVE_READ_SCOPE] },
  /** `comments.list`: the comment threads of a file that is not a spreadsheet. */
  comments: { method: "GET", host: DRIVE_HOST, path: `${FILES_PATH}/{file_id}/comments`, scopes: [DRIVE_READ_SCOPE] },
  /** `spreadsheets.get`, which with a comments view mode also gives the spreadsheet's comment threads and their anchors. */
  spreadsheet: {
    method: "GET",
    host: SHEETS_HOST,
    path: "/v4/spreadsheets/{spreadsheet_id}",
    scopes: [SHEETS_READ_SCOPE, SHEETS_WRITE_SCOPE],
  },
  /** `comments.get`: one comment of a file that is not a spreadsheet, to check it before a reply. */
  comment: {
    method: "GET",
    host: DRIVE_HOST,
    path: `${FILES_PATH}/{file_id}/comments/{comment_id}`,
    scopes: [DRIVE_READ_SCOPE],
  },
  /** `comments.create`: a new comment on a file that is not a spreadsheet. */
  commentCreate: {
    method: "POST",
    host: DRIVE_HOST,
    path: `${FILES_PATH}/{file_id}/comments`,
    scopes: [DRIVE_FILE_SCOPE],
  },
  /** `replies.create`: a reply to a comment of a file that is not a spreadsheet. */
  replyCreate: {
    method: "POST",
    host: DRIVE_HOST,
    path: `${FILES_PATH}/{file_id}/comments/{comment_id}/replies`,
    scopes: [DRIVE_FILE_SCOPE],
  },
  /** `spreadsheets.batchUpdate` with one `insertComment` or `addCommentReply` request. */
  batchUpdate: {
    method: "POST",
    host: SHEETS_HOST,
    path: "/v4/spreadsheets/{spreadsheet_id}:batchUpdate",
    scopes: [SHEETS_WRITE_SCOPE],
  },
} as const satisfies Record<string, Route>
