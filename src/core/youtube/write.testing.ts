import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { z } from "zod"
import type { Credential } from "../google/credentials"
import type { FakeHandler } from "../google/fake-google.testing"
import { writeTargets } from "../targets"
import { invoke, type ToolContext, type ToolOptions, type ToolSpec } from "../tool"
import { googleYoutubePrivacySet } from "./privacy"
import {
  CHANNEL,
  CHANNELS_URL,
  VIDEO,
  VIDEOS_URL,
  YOUTUBE_CREDENTIAL,
  cleanUp as cleanUpState,
  fixture,
  requestLine,
  respond,
} from "./read.testing"
import { googleYoutubeThumbnailSet } from "./thumbnail"
import { googleYoutubeVideoEdit } from "./video-edit"

/** Fixtures the YouTube write tests share: the read fixtures with a label that may read and write, the label's channel and one of its videos as Google gives them, and the write tools bound to them. */

export {
  CHANNEL,
  CHANNELS_URL,
  OTHER_CHANNEL,
  OTHER_VIDEO,
  READ_ONLY_CREDENTIAL,
  VIDEO,
  VIDEOS_URL,
  freshTokens,
  refusal,
  requestLine,
  respond,
} from "./read.testing"

/** The title of the made-up video. */
export const TITLE = "A made-up video"

/** The address of the thumbnail upload. */
export const THUMBNAILS_URL = "https://www.googleapis.com/upload/youtube/v3/thumbnails/set"

/** The thumbnails the made-up upload answers with: three sizes, one of them with no size given. */
const THUMBNAILS = {
  default: { url: "https://i.ytimg.test/default.jpg", width: 120, height: 90 },
  medium: { url: "https://i.ytimg.test/mqdefault.jpg", width: 320, height: 180 },
  high: { url: "https://i.ytimg.test/hqdefault.jpg" },
}

type Parts = { snippet?: Record<string, unknown>; status?: Record<string, unknown>; localizations?: unknown }

/**
 * The made-up video as `videos.list` gives it with `snippet`, `status` and
 * `localizations`: public, in category 22, English, with two tags, a Japanese
 * localization and fields the tools never send. Each part in `parts` is laid
 * over its own.
 */
export const writableVideo = (parts: Parts = {}) => ({
  id: VIDEO,
  snippet: {
    publishedAt: "2026-03-01T09:00:00Z",
    channelId: CHANNEL,
    title: TITLE,
    description: "About made-up things.",
    thumbnails: { default: { url: "https://i.ytimg.test/default.jpg" } },
    channelTitle: "Made-up channel",
    tags: ["made", "up"],
    categoryId: "22",
    liveBroadcastContent: "none",
    defaultLanguage: "en",
    defaultAudioLanguage: "en",
    ...parts.snippet,
  },
  status: {
    uploadStatus: "processed",
    privacyStatus: "public",
    license: "youtube",
    embeddable: true,
    publicStatsViewable: true,
    madeForKids: false,
    selfDeclaredMadeForKids: false,
    containsSyntheticMedia: false,
    ...parts.status,
  },
  localizations: parts.localizations ?? { ja: { title: "作り話の動画", description: "作り話です。" } },
})

/** `GET` of the label's own channel, answering `id`. */
export const channelHandler = (id = CHANNEL): FakeHandler => respond(CHANNELS_URL, { json: { items: [{ id }] } })

/** `GET` of the video list, answering the videos given: one video, by default the made-up one. */
export const videoHandler = (...videos: unknown[]): FakeHandler =>
  respond(VIDEOS_URL, { json: { items: videos.length === 0 ? [writableVideo()] : videos } })

/** `GET` of the video list, answering `reply` as it is: an error, say. */
export const videoReplyHandler = (reply: FakeHandler["reply"]): FakeHandler => respond(VIDEOS_URL, reply)

/** `PUT` of the video, answering `reply`; by default Google reports exactly the body it was sent. */
export const updateHandler = (reply: FakeHandler["reply"] = (request) => ({ json: request.json })): FakeHandler => ({
  method: "PUT",
  url: VIDEOS_URL,
  reply,
})

/** `POST` of the thumbnail upload, answering `reply`; by default one thumbnail of each size Google makes. */
export const thumbnailHandler = (reply: FakeHandler["reply"] = { json: { items: [THUMBNAILS] } }): FakeHandler => ({
  method: "POST",
  url: THUMBNAILS_URL,
  reply,
})

const madeDirs: string[] = []

/** Removes the fixtures' state and the upload directories they made. */
export async function cleanUp(): Promise<void> {
  await cleanUpState()
  for (const dir of madeDirs.splice(0)) await rm(dir, { recursive: true, force: true })
}

/** A tool bound to a fixture's context: its call, its prompt and its targets. */
function bound<I extends z.ZodObject<any>, O extends z.ZodObject<any>>(
  spec: ToolSpec<I, O>,
  ctx: ToolContext,
  defaults: Record<string, unknown>,
) {
  const withDefaults = (args: unknown) => ({ ...defaults, ...(args as object) })
  return {
    run: (args: unknown = {}) => invoke(spec, withDefaults(args), ctx),
    describe: async (args: unknown = {}) => spec.describe!(spec.input.parse(withDefaults(args)), ctx),
    targets: (args: unknown = {}) => writeTargets(spec, withDefaults(args), ctx),
  }
}

/**
 * The YouTube fixtures with `credential` (a label that may read and write
 * unless given, `null` for none), the label's channel, the video (`CHANNEL`'s
 * `writableVideo()`) and an update that echoes its body, then `handlers` first,
 * so a test can answer otherwise; the write tools are bound to them for `VIDEO`.
 */
export async function writeFixture(
  options: {
    handlers?: FakeHandler[]
    credential?: Credential | null
    /** The files of the upload directory `upload_dirs` names (name to content). */
    files?: Record<string, string | Uint8Array>
    /** What `upload_dirs` names, given the upload directory; default that directory. */
    uploadDirs?: (uploadDir: string) => string[]
    /** The package's other settings (`encrypt_dirs`, `youtube_upload_max_gib`), given the upload directory. */
    settings?: (uploadDir: string) => ToolOptions
  } = {},
) {
  const h = await fixture(
    [...(options.handlers ?? []), channelHandler(), videoHandler(), updateHandler(), thumbnailHandler()],
    options.credential === undefined ? YOUTUBE_CREDENTIAL : options.credential,
  )
  const uploadDir = join(await realpath(await mkdtemp(join(tmpdir(), "youtube-upload-"))), "outbox")
  madeDirs.push(uploadDir)
  await mkdir(uploadDir)
  for (const [name, content] of Object.entries(options.files ?? {})) await writeFile(join(uploadDir, name), content)
  const ctx = {
    ...h.ctx,
    options: { upload_dirs: options.uploadDirs?.(uploadDir) ?? [uploadDir], ...options.settings?.(uploadDir) },
  }
  return {
    ...h,
    ctx,
    uploadDir,
    edit: bound(googleYoutubeVideoEdit, ctx, { video: VIDEO }),
    privacy: bound(googleYoutubePrivacySet, ctx, { video: VIDEO }),
    thumbnail: bound(googleYoutubeThumbnailSet, ctx, { video: VIDEO }),
    /** The requests that changed something. */
    writes: () => h.calls().filter((request) => request.method !== "GET"),
    /** What the fake received, as `METHOD url`. */
    lines: () => h.calls().map(requestLine),
  }
}

export type WriteFixture = Awaited<ReturnType<typeof writeFixture>>
