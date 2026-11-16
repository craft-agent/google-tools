import { extname } from "node:path"
import { UNKNOWN_MIME_TYPE } from "./schemas"

/** The media types of the file extensions an attachment commonly has; any other is sent as `UNKNOWN_MIME_TYPE`. */
const TYPES_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gif": "image/gif",
  ".html": "text/html",
  ".ics": "text/calendar",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".webp": "image/webp",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xml": "application/xml",
  ".zip": "application/zip",
}

/** The media type of an attachment named `name`, by its extension (any case), else `application/octet-stream`. */
export function attachmentType(name: string): string {
  const extension = extname(name).toLowerCase()
  return Object.hasOwn(TYPES_BY_EXTENSION, extension) ? TYPES_BY_EXTENSION[extension]! : UNKNOWN_MIME_TYPE
}
