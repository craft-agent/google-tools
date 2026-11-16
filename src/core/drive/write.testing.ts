import type { Credential } from "../google/credentials"
import type { FakeHandler, FakeReply } from "../google/fake-google.testing"
import { writeTargets } from "../targets"
import { invoke, type ToolContext, type ToolSpec } from "../tool"
import { googleDriveCopy } from "./copy"
import { googleDriveFolderCreate } from "./folder-create"
import { googleDriveMove } from "./move"
import { driveFile, driveFolder, fileUrl, fixture } from "./read.testing"
import { googleDriveRename } from "./rename"
import { googleDriveRestore } from "./restore"
import { googleDriveTrash } from "./trash"
import { UPLOAD_CREDENTIAL, rootHandlers } from "./upload.testing"

/** Fixtures the Drive write tests share: the Drive read fixtures with a label that may read and write, the top of My Drive, and the six write tools bound to them. */

export {
  FILES_URL,
  FILE_ID,
  FOLDER_ID,
  OWNER,
  SHARED_DRIVE_ID,
  answer,
  callOf,
  cleanUp,
  driveFile,
  driveFolder,
  fileUrl,
  freshTokens,
  permissionsUrl,
  refusal,
} from "./read.testing"
export { NEW_FILE_ID, ROOT_ID, UPLOAD_CREDENTIAL, ownFolderHandlers } from "./upload.testing"

/** Another made-up folder, the second of two folders of the tests. */
export const OTHER_FOLDER_ID = "1MadeUpOtherFolderId_abcdefghij-0123"

/** A tool bound to a fixture's context: its call, its prompt, its targets and its bounds. */
function bound(spec: ToolSpec, ctx: ToolContext) {
  return {
    run: (args: unknown) => invoke(spec, args, ctx),
    describe: async (args: unknown) => spec.describe!(spec.input.parse(args), ctx),
    targets: (args: unknown) => writeTargets(spec, args, ctx),
    measure: async (args: unknown) => spec.measure!(spec.input.parse(args), ctx),
  }
}

/** The handler that answers `files.get` of `id` with a file, `version` 7 and a copy the account may make, `extra` laid over it. */
export const itemHandler = (id: string, extra: Record<string, unknown> = {}): FakeHandler => ({
  method: "GET",
  url: fileUrl(id),
  reply: { json: driveFile(id, { version: "7", capabilities: { canCopy: true }, ...extra }) },
})

/** The handler that answers `files.get` of any id with the file `File <id>`, `version` 7, and what `extra(id)` lays over it, after `before` (which a test uses to hold a read). */
export const itemsHandler = (
  extra: (id: string) => Record<string, unknown> = () => ({}),
  before?: () => Promise<void>,
): FakeHandler => ({
  method: "GET",
  url: /\/drive\/v3\/files\/[^/?]+\?/,
  reply: async (request) => {
    await before?.()
    const id = request.url.pathname.split("/").pop()!
    return { json: driveFile(id, { name: `File ${id}`, version: "7", ...extra(id) }) }
  },
})

/** The handler that answers `files.get` of `id` with a folder, `extra` laid over it. */
export const folderHandler = (id: string, extra: Record<string, unknown> = {}): FakeHandler => ({
  method: "GET",
  url: fileUrl(id),
  reply: { json: driveFolder(id, { version: "3", ...extra }) },
})

/** The handler that takes a PATCH of `id` and answers `reply`. */
export const patchHandler = (
  id: string | RegExp,
  reply: FakeReply | ((id: string) => FakeReply) = {},
): FakeHandler => ({
  method: "PATCH",
  url: typeof id === "string" ? fileUrl(id) : id,
  reply: typeof reply === "function" ? (request) => reply(request.url.pathname.split("/").pop()!) : reply,
})

/** What Drive answers a write it refuses for drive.file: `status` 403 or 404 with a reason. */
export const refused = (status: 403 | 404): FakeReply => ({
  status,
  json: {
    error: {
      code: status,
      message: "File not found.",
      errors: [{ reason: status === 404 ? "notFound" : "forbidden" }],
    },
  },
})

/** `count` made-up ids with `prefix`, such as `f001`. */
export const idsOf = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1).padStart(3, "0")}`)

/**
 * The Drive fixtures with `credential` (a label that may read and write unless
 * given, `null` for none), the top of My Drive, `handlers` ahead of it and the
 * write tools bound to them.
 */
export async function writeFixture(options: { handlers?: FakeHandler[]; credential?: Credential | null } = {}) {
  const h = await fixture(
    [...(options.handlers ?? []), ...rootHandlers],
    options.credential === undefined ? UPLOAD_CREDENTIAL : options.credential,
  )
  return {
    ...h,
    folderCreate: bound(googleDriveFolderCreate, h.ctx),
    copy: bound(googleDriveCopy, h.ctx),
    rename: bound(googleDriveRename, h.ctx),
    move: bound(googleDriveMove, h.ctx),
    trash: bound(googleDriveTrash, h.ctx),
    restore: bound(googleDriveRestore, h.ctx),
    /** The requests that changed something. */
    writes: () => h.calls().filter((request) => request.method !== "GET"),
  }
}

export type WriteFixture = Awaited<ReturnType<typeof writeFixture>>
