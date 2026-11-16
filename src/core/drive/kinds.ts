/** The media types Drive gives its own kinds of file, all of them under one prefix. */
const GOOGLE_APPS_PREFIX = "application/vnd.google-apps."

export const FOLDER_MIME_TYPE = `${GOOGLE_APPS_PREFIX}folder`
export const SHORTCUT_MIME_TYPE = `${GOOGLE_APPS_PREFIX}shortcut`
export const DOCUMENT_MIME_TYPE = `${GOOGLE_APPS_PREFIX}document`
export const SPREADSHEET_MIME_TYPE = `${GOOGLE_APPS_PREFIX}spreadsheet`
export const PRESENTATION_MIME_TYPE = `${GOOGLE_APPS_PREFIX}presentation`
export const DRAWING_MIME_TYPE = `${GOOGLE_APPS_PREFIX}drawing`
export const SCRIPT_MIME_TYPE = `${GOOGLE_APPS_PREFIX}script`
export const VIDEO_MIME_TYPE = `${GOOGLE_APPS_PREFIX}vid`

/** What a file is, as a model reads it: a folder, a shortcut, one of the Google editors' files or any other file. */
export const FILE_KINDS = [
  "folder",
  "google_doc",
  "google_sheet",
  "google_slides",
  "google_drawing",
  "google_other",
  "shortcut",
  "file",
] as const

export type FileKind = (typeof FILE_KINDS)[number]

/** The kind of each Drive media type that has a kind of its own. */
const KINDS_BY_MIME_TYPE: Readonly<Record<string, FileKind>> = {
  [FOLDER_MIME_TYPE]: "folder",
  [SHORTCUT_MIME_TYPE]: "shortcut",
  [DOCUMENT_MIME_TYPE]: "google_doc",
  [SPREADSHEET_MIME_TYPE]: "google_sheet",
  [PRESENTATION_MIME_TYPE]: "google_slides",
  [DRAWING_MIME_TYPE]: "google_drawing",
}

/** The kind of a file of media type `mimeType`; any other Google type is `google_other`. */
export function kindOf(mimeType: string): FileKind {
  const known = Object.hasOwn(KINDS_BY_MIME_TYPE, mimeType) ? KINDS_BY_MIME_TYPE[mimeType] : undefined
  if (known !== undefined) return known
  return mimeType.startsWith(GOOGLE_APPS_PREFIX) ? "google_other" : "file"
}

/** Whether the kind is a file of the Google editors, which only an export gives out. */
export function isGoogleFile(kind: FileKind): boolean {
  return kind.startsWith("google_")
}
