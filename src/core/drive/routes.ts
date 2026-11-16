import type { Route } from "../google/routes"
import { DRIVE_FILE_SCOPE, DRIVE_READ_SCOPE } from "./scopes"

const DRIVE_HOST = "www.googleapis.com"

const FILES_PATH = "/drive/v3/files"

const UPLOAD_FILES_PATH = "/upload/drive/v3/files"

/** The scopes that read Drive: `drives.list` accepts only the drive and drive.readonly scopes, so every read takes the one. */
const READ_SCOPES = [DRIVE_READ_SCOPE] as const

/** The calls the Drive tools may make, each with every scope that allows it, narrowest first. */
export const DRIVE_ROUTES = {
  files: { method: "GET", host: DRIVE_HOST, path: FILES_PATH, scopes: READ_SCOPES },
  file: { method: "GET", host: DRIVE_HOST, path: `${FILES_PATH}/{file_id}`, scopes: READ_SCOPES },
  /** `files.get` with `alt=media`, the file's own bytes; a separate route so a download is told from a metadata read. */
  media: { method: "GET", host: DRIVE_HOST, path: `${FILES_PATH}/{file_id}`, scopes: READ_SCOPES },
  export: { method: "GET", host: DRIVE_HOST, path: `${FILES_PATH}/{file_id}/export`, scopes: READ_SCOPES },
  permissions: { method: "GET", host: DRIVE_HOST, path: `${FILES_PATH}/{file_id}/permissions`, scopes: READ_SCOPES },
  drives: { method: "GET", host: DRIVE_HOST, path: "/drive/v3/drives", scopes: READ_SCOPES },
  /** Opens a resumable upload (`uploadType=resumable`), which creates a file when its last byte lands. */
  uploadStart: { method: "POST", host: DRIVE_HOST, path: UPLOAD_FILES_PATH, scopes: [DRIVE_FILE_SCOPE] },
  /** Sends the bytes of an upload to the session address `uploadStart` answered with. */
  uploadChunk: { method: "PUT", host: DRIVE_HOST, path: UPLOAD_FILES_PATH, scopes: [DRIVE_FILE_SCOPE] },
} as const satisfies Record<string, Route>
