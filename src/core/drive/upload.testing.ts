import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CREDENTIAL } from "../google/client.fixtures"
import type { Credential } from "../google/credentials"
import type { FakeHandler, FakeReply, FakeRequest } from "../google/fake-google.testing"
import { writeTargets } from "../targets"
import { invoke } from "../tool"
import { FOLDER_MIME_TYPE } from "./kinds"
import { FILES_URL, FOLDER_ID, OWNER, answer, fileUrl, fixture, permissionsUrl } from "./read.testing"
import { DRIVE_FILE_SCOPE, DRIVE_READ_SCOPE } from "./scopes"
import { driveUploadTool } from "./upload"

/** Fixtures the Drive upload tests share: the Drive read fixtures with a label that may write, an upload directory the setting names, a fake Drive that takes an upload in chunks and the tool. */

export {
  FILES_URL,
  FOLDER_ID,
  OWNER,
  answer,
  callOf,
  cleanUp,
  fileUrl,
  freshTokens,
  permissionsUrl,
} from "./read.testing"

/** What a label logged in for the drive toolset, reading and writing, holds; its address is `someone@example.test`. */
export const UPLOAD_CREDENTIAL: Credential = {
  ...CREDENTIAL,
  scopes: [...CREDENTIAL.scopes, DRIVE_READ_SCOPE, DRIVE_FILE_SCOPE],
}

export const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files"

/** Made-up ids: the top of My Drive, the session of an upload and the file it makes. */
export const ROOT_ID = "0AMadeUpRootFolderId_Uk9PVA"
export const UPLOAD_ID = "madeUpUploadId-AAAA0123456789"
export const NEW_FILE_ID = "1MadeUpNewFileId_abcdefghij-0123456789"

/** The smallest chunk a session takes: 256 KiB, which the tests send small files in. */
export const SMALL_CHUNK = 256 * 1024

/** The address of the made-up session, which a start answers with. */
export const SESSION_URI = `${UPLOAD_URL}?uploadType=resumable&upload_id=${UPLOAD_ID}`

/** How the fake Drive takes in an upload. */
export type SessionOptions = {
  /** What the session holds after a chunk that brought it to `held` bytes, given the chunk and how many came so far (1 for the first); default `held`. */
  acknowledge?: (held: number, chunk: FakeRequest, count: number) => number
}

/**
 * The handlers of a fake Drive that takes in one resumable upload: a start
 * that answers with the session address, then chunks, each answered with `308`
 * and the `Range` it holds, or with the new file once it holds every byte.
 * `received()` is what the chunks carried, at their places.
 */
export function sessionHandlers({ acknowledge = (held) => held }: SessionOptions = {}) {
  let metadata: { name?: string; mimeType?: string; parents?: string[] } = {}
  let content = Buffer.alloc(0)
  let count = 0
  const start: FakeHandler = {
    method: "POST",
    url: UPLOAD_URL,
    reply: (request) => {
      metadata = request.json as typeof metadata
      return { headers: { location: SESSION_URI } }
    },
  }
  const chunk: FakeHandler = {
    method: "PUT",
    url: UPLOAD_URL,
    reply: (request): FakeReply => {
      const range = /^bytes (?:(\d+)-(\d+)|\*)\/(\d+)$/.exec(request.headers["content-range"] ?? "")!
      const total = Number(range[3])
      if (content.length !== total) content = Buffer.alloc(total)
      const begin = Number(range[1] ?? 0)
      Buffer.from(request.bytes!).copy(content, begin)
      const held = acknowledge(range[2] === undefined ? 0 : Number(range[2]) + 1, request, ++count)
      if (held < total) {
        return { status: 308, headers: held === 0 ? {} : { range: `bytes=0-${held - 1}` } }
      }
      return {
        json: {
          id: NEW_FILE_ID,
          name: metadata.name,
          mimeType: metadata.mimeType,
          size: String(total),
          parents: metadata.parents,
          webViewLink: `https://drive.google.com/file/d/${NEW_FILE_ID}/view`,
        },
      }
    },
  }
  return { handlers: [start, chunk], received: () => content }
}

/** The handlers that show an own, unshared folder: the folder itself and its one permission, the owner's. */
export const ownFolderHandlers = (id = FOLDER_ID, extra: Record<string, unknown> = {}): FakeHandler[] => [
  answer(fileUrl(id), {
    id,
    name: "Projects",
    mimeType: FOLDER_MIME_TYPE,
    owners: [{ emailAddress: OWNER }],
    trashed: false,
    ...extra,
  }),
  answer(permissionsUrl(id), { permissions: [{ id: "p1", type: "user", role: "owner", emailAddress: OWNER }] }),
]

/** The handlers of the top of My Drive and of a folder that holds no file of the name. */
export const rootHandlers: FakeHandler[] = [
  answer(fileUrl("root"), { id: ROOT_ID, name: "My Drive" }),
  answer(FILES_URL, { files: [] }),
]

const made: string[] = []

/** Removes the upload directories the fixtures made. */
export async function removeUploads(): Promise<void> {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true })
}

/**
 * The Drive fixtures with `credential` (a label that may read and write unless
 * given, `null` for none), an upload directory holding `files` (name to
 * content) that the `upload_dirs` setting names unless `uploadDirs` says
 * otherwise, the handlers of the top of My Drive and of a session, `handlers`
 * ahead of them, and the upload tool sending in chunks of `chunkBytes`.
 */
export async function uploadFixture(
  options: {
    handlers?: FakeHandler[]
    credential?: Credential | null
    files?: Record<string, string | Uint8Array>
    uploadDirs?: (uploadDir: string, stateDir: string) => string[]
    /** The package's other settings (`encrypt_dirs`, `age_recipients`), given the upload directory. */
    settings?: (uploadDir: string) => Record<string, readonly string[]>
    /** The runtime's environment, which names where programs such as `age` are looked for. */
    env?: Record<string, string>
    chunkBytes?: number
    session?: SessionOptions
  } = {},
) {
  const session = sessionHandlers(options.session)
  const h = await fixture(
    [...(options.handlers ?? []), ...rootHandlers, ...session.handlers],
    options.credential === undefined ? UPLOAD_CREDENTIAL : options.credential,
    options.env,
  )
  const uploadDir = join(await realpath(await mkdtemp(join(tmpdir(), "drive-upload-"))), "outbox")
  made.push(uploadDir)
  await mkdir(uploadDir)
  for (const [name, content] of Object.entries(options.files ?? {})) await writeFile(join(uploadDir, name), content)
  const ctx = {
    ...h.ctx,
    options: {
      upload_dirs: options.uploadDirs?.(uploadDir, h.stateDir) ?? [uploadDir],
      ...options.settings?.(uploadDir),
    },
  }
  const tool = driveUploadTool({ chunkBytes: options.chunkBytes ?? SMALL_CHUNK })
  return {
    ...h,
    ctx,
    uploadDir,
    tool,
    /** What the session's chunks carried. */
    received: session.received,
    upload: (args: unknown) => invoke(tool, args, ctx),
    describe: async (args: unknown) => tool.describe!(tool.input.parse(args), ctx),
    measure: async (args: unknown) => tool.measure!(tool.input.parse(args), ctx),
    targets: (args: unknown) => writeTargets(tool, args, ctx),
    /** The requests that went to the upload route: the start first, then each chunk. */
    uploads: () => h.calls().filter((request) => request.url.pathname === "/upload/drive/v3/files"),
  }
}
