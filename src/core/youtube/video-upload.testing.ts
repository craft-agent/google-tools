import type { Credential } from "../google/credentials"
import type { FakeHandler, FakeReply, FakeRequest } from "../google/fake-google.testing"
import { writeTargets } from "../targets"
import { invoke, type ToolOptions } from "../tool"
import { writeFixture } from "./write.testing"
import { youtubeVideoUploadTool } from "./video-upload"

/** Fixtures the video upload tests share: the YouTube write fixtures, a fake YouTube that takes an upload in chunks, and the upload tool. */

export { OTHER_CHANNEL, TITLE, cleanUp, freshTokens, refusal } from "./write.testing"

export const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos"

/** Made-up ids: the session of an upload and the video it makes. */
export const UPLOAD_ID = "madeUpYoutubeUploadId-AAAA0123456789"
export const NEW_VIDEO_ID = "newVideo_01"

/** The smallest chunk a session takes: 256 KiB, which the tests send small files in. */
export const SMALL_CHUNK = 256 * 1024

/** The address of the made-up session, which a start answers with. */
export const SESSION_URI = `${UPLOAD_URL}?uploadType=resumable&upload_id=${UPLOAD_ID}`

/** What every call carries unless a test says otherwise: a title and the declaration YouTube requires. */
export const CALL = { title: "My new video", made_for_kids: false }

/** How the fake YouTube takes in an upload. */
export type SessionOptions = {
  /** What the session holds after a chunk that brought it to `held` bytes, given the chunk and how many came so far (1 for the first); default `held`. */
  acknowledge?: (held: number, chunk: FakeRequest, count: number) => number
}

type Metadata = { snippet?: { title?: string }; status?: { selfDeclaredMadeForKids?: boolean } }

/**
 * The handlers of a fake YouTube that takes in one resumable upload: a start
 * that answers with the session address, then chunks, each answered with `308`
 * and the `Range` it holds, or with the new private video once it holds every
 * byte. `received()` is what the chunks carried, at their places.
 */
export function sessionHandlers({ acknowledge = (held) => held }: SessionOptions = {}) {
  let metadata: Metadata = {}
  let content = Buffer.alloc(0)
  let count = 0
  const start: FakeHandler = {
    method: "POST",
    url: UPLOAD_URL,
    reply: (request) => {
      metadata = request.json as Metadata
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
      Buffer.from(request.bytes!).copy(content, Number(range[1] ?? 0))
      const held = acknowledge(range[2] === undefined ? 0 : Number(range[2]) + 1, request, ++count)
      if (held < total) {
        return { status: 308, headers: held === 0 ? {} : { range: `bytes=0-${held - 1}` } }
      }
      return {
        json: {
          id: NEW_VIDEO_ID,
          snippet: { title: metadata.snippet?.title },
          status: {
            privacyStatus: "private",
            uploadStatus: "uploaded",
            madeForKids: false,
            selfDeclaredMadeForKids: metadata.status?.selfDeclaredMadeForKids,
          },
        },
      }
    },
  }
  return { handlers: [start, chunk], received: () => content }
}

/**
 * The YouTube write fixtures with a fake session ahead of the defaults, and
 * the upload tool sending in chunks of `chunkBytes`; `upload`, `describe`,
 * `measure` and `targets` take the call's arguments, `CALL` under them.
 */
export async function uploadFixture(
  options: {
    handlers?: FakeHandler[]
    credential?: Credential | null
    files?: Record<string, string | Uint8Array>
    uploadDirs?: (uploadDir: string) => string[]
    settings?: (uploadDir: string) => ToolOptions
    chunkBytes?: number
    session?: SessionOptions
  } = {},
) {
  const session = sessionHandlers(options.session)
  const { chunkBytes = SMALL_CHUNK, session: _session, ...rest } = options
  const h = await writeFixture({ ...rest, handlers: [...(options.handlers ?? []), ...session.handlers] })
  const tool = youtubeVideoUploadTool({ chunkBytes })
  const withCall = (args: unknown) => ({ ...CALL, ...(args as object) })
  return {
    ...h,
    tool,
    /** What the session's chunks carried. */
    received: session.received,
    upload: (args: unknown) => invoke(tool, withCall(args), h.ctx),
    describe: async (args: unknown) => tool.describe!(tool.input.parse(withCall(args)), h.ctx),
    measure: async (args: unknown) => tool.measure!(tool.input.parse(withCall(args)), h.ctx),
    targets: (args: unknown) => writeTargets(tool, withCall(args), h.ctx),
    /** The requests that went to the upload route: the start first, then each chunk. */
    uploads: () => h.calls().filter((request) => request.url.pathname === "/upload/youtube/v3/videos"),
  }
}

export type UploadFixture = Awaited<ReturnType<typeof uploadFixture>>

/** The `Content-Range` of each chunk the fake received, in order. */
export const rangesOf = (h: UploadFixture) =>
  h
    .uploads()
    .filter((request) => request.method === "PUT")
    .map((request) => request.headers["content-range"])
