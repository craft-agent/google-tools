import { CREDENTIAL } from "../google/client.fixtures"
import type { Credential } from "../google/credentials"
import type { FakeHandler, FakeReply } from "../google/fake-google.testing"
import { fixture as sheetsFixture } from "../sheets/read.testing"
import { invoke } from "../tool"
import { FOLDER_MIME_TYPE } from "./kinds"
import { googleDriveRead } from "./read"
import { DRIVE_READ_SCOPE } from "./scopes"

/** Fixtures the Drive read tests share: the state directory, download directory and fake Google of the Sheets fixtures, with a label logged in for Drive and the Drive read as the tool. */

export { answer, callOf, cleanUp, freshTokens } from "../sheets/read.testing"

/** What a label logged in for the drive toolset, read only, holds. */
export const DRIVE_CREDENTIAL: Credential = { ...CREDENTIAL, scopes: [...CREDENTIAL.scopes, DRIVE_READ_SCOPE] }

export const FILES_URL = "https://www.googleapis.com/drive/v3/files"
export const DRIVES_URL = "https://www.googleapis.com/drive/v3/drives"

/** Made-up Drive ids, as Drive writes them. */
export const FILE_ID = "1MadeUpFileId_abcdefghij-0123456789"
export const FOLDER_ID = "1MadeUpFolderId_abcdefghij-012345"
export const SHARED_DRIVE_ID = "0AMadeUpSharedDriveId_Uk9PVA"

/** The made-up account that owns the files below, which the credential's address is. */
export const OWNER = "someone@example.test"

export const fileUrl = (id: string) => `${FILES_URL}/${id}`
export const exportUrl = (id: string) => `${FILES_URL}/${id}/export`
export const permissionsUrl = (id: string) => `${FILES_URL}/${id}/permissions`

export const GOOGLE_APPS = "application/vnd.google-apps."

/** A file as `files.get` and `files.list` give it, with `extra` laid over it. */
export const driveFile = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: "Budget 2026.pdf",
  mimeType: "application/pdf",
  size: "2048",
  modifiedTime: "2026-05-30T08:00:00.000Z",
  createdTime: "2026-05-01T09:30:00.000Z",
  parents: [FOLDER_ID],
  owners: [{ emailAddress: OWNER }],
  shared: false,
  trashed: false,
  webViewLink: `https://drive.google.com/file/d/${id}/view`,
  starred: false,
  ...extra,
})

/** A folder as `files.get` gives it. */
export const driveFolder = (id: string, extra: Record<string, unknown> = {}) =>
  driveFile(id, { name: "Projects", mimeType: FOLDER_MIME_TYPE, size: undefined, ...extra })

/** A GET handler for `url` that answers with `reply` and sees the request. */
export const respond = (url: string, reply: FakeHandler["reply"]): FakeHandler => ({ method: "GET", url, reply })

/** What Drive answers with for a refused call: an error body in its own shape, with a status and a reason. */
export const refusal = (status: number, reason: string, message = "Refused."): FakeReply => ({
  status,
  json: { error: { code: status, message, errors: [{ domain: "global", reason, message }] } },
})

/** The fixtures with a label logged in for Drive, and `read` calling the Drive read. */
export async function fixture(
  handlers: FakeHandler[] = [],
  credential: Credential | null = DRIVE_CREDENTIAL,
  env: Record<string, string> = {},
) {
  const h = await sheetsFixture(handlers, credential, env)
  return { ...h, read: (args: unknown) => invoke(googleDriveRead, args, h.ctx) }
}

export type Fixture = Awaited<ReturnType<typeof fixture>>
