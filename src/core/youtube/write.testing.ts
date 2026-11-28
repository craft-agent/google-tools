import type { z } from "zod"
import type { Credential } from "../google/credentials"
import type { FakeHandler } from "../google/fake-google.testing"
import { writeTargets } from "../targets"
import { invoke, type ToolContext, type ToolSpec } from "../tool"
import { googleYoutubePrivacySet } from "./privacy"
import {
  CHANNEL,
  CHANNELS_URL,
  VIDEO,
  VIDEOS_URL,
  YOUTUBE_CREDENTIAL,
  fixture,
  requestLine,
  respond,
} from "./read.testing"
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
  cleanUp,
  freshTokens,
  refusal,
  requestLine,
  respond,
} from "./read.testing"

/** The title of the made-up video. */
export const TITLE = "A made-up video"

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
export async function writeFixture(options: { handlers?: FakeHandler[]; credential?: Credential | null } = {}) {
  const h = await fixture(
    [...(options.handlers ?? []), channelHandler(), videoHandler(), updateHandler()],
    options.credential === undefined ? YOUTUBE_CREDENTIAL : options.credential,
  )
  return {
    ...h,
    edit: bound(googleYoutubeVideoEdit, h.ctx, { video: VIDEO }),
    privacy: bound(googleYoutubePrivacySet, h.ctx, { video: VIDEO }),
    /** The requests that changed something. */
    writes: () => h.calls().filter((request) => request.method !== "GET"),
    /** What the fake received, as `METHOD url`. */
    lines: () => h.calls().map(requestLine),
  }
}

export type WriteFixture = Awaited<ReturnType<typeof writeFixture>>
