import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { z } from "zod"
import type { Credential } from "../google/credentials"
import type { FakeHandler, FakeRequest } from "../google/fake-google.testing"
import { writeTargets } from "../targets"
import { invoke, type ToolContext, type ToolOptions, type ToolSpec } from "../tool"
import { googleYoutubeCaptionAdd } from "./caption-add"
import { googleYoutubeCaptionUpdate } from "./caption-update"
import { googleYoutubeChannelEdit } from "./channel-edit"
import { googleYoutubeCommentModerate } from "./comment-moderate"
import { googleYoutubeCommentReject } from "./comment-reject"
import { googleYoutubeCommentReply } from "./comment-reply"
import { googleYoutubePlaylistAdd } from "./playlist-add"
import { googleYoutubePlaylistCreate } from "./playlist-create"
import { googleYoutubePlaylistEdit } from "./playlist-edit"
import { googleYoutubePlaylistMove } from "./playlist-move"
import { googleYoutubePlaylistRemove } from "./playlist-remove"
import { googleYoutubePrivacySet } from "./privacy"
import {
  CAPTIONS_URL,
  CHANNEL,
  CHANNELS_URL,
  COMMENTS_URL,
  COMMENT_THREADS_URL,
  PLAYLIST,
  PLAYLISTS_URL,
  PLAYLIST_ITEMS_URL,
  THREAD,
  UPLOADS,
  VIDEO,
  VIDEOS_URL,
  YOUTUBE_CREDENTIAL,
  cleanUp as cleanUpState,
  commentResource,
  fixture,
  requestLine,
  respond,
} from "./read.testing"
import { googleYoutubeThumbnailSet } from "./thumbnail"
import { googleYoutubeVideoEdit } from "./video-edit"
import { googleYoutubeWatermarkRemove } from "./watermark-remove"
import { googleYoutubeWatermarkSet } from "./watermark-set"

/** Fixtures the YouTube write tests share: the read fixtures with a label that may read and write, the label's channel and one of its videos as Google gives them, and the write tools bound to them. */

export {
  CHANNEL,
  CHANNELS_URL,
  COMMENTS_URL,
  COMMENT_THREADS_URL,
  OTHER_CHANNEL,
  OTHER_VIDEO,
  PLAYLIST,
  PLAYLISTS_URL,
  PLAYLIST_ITEMS_URL,
  READ_ONLY_CREDENTIAL,
  THREAD,
  UPLOADS,
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

/** The name of the made-up channel. */
export const CHANNEL_TITLE = "Made-up channel"

type ChannelParts = { snippet?: Record<string, unknown>; channel?: Record<string, unknown>; localizations?: unknown }

/**
 * The label's own channel as `channels.list` gives it with `snippet`,
 * `brandingSettings`, `localizations` and `contentDetails`: Japanese, in
 * Japan, with three keywords (one of them a phrase), a trailer, an English
 * localization, and branding properties the tools never change (a banner and
 * hints). The snippet and the branding settings' `channel` are laid over their
 * own, so a property given as `undefined` is left out.
 */
export const writableChannel = (parts: ChannelParts = {}) => ({
  id: CHANNEL,
  snippet: {
    title: CHANNEL_TITLE,
    description: "A channel about made-up things.",
    country: "JP",
    defaultLanguage: "ja",
    ...parts.snippet,
  },
  brandingSettings: {
    channel: {
      title: CHANNEL_TITLE,
      description: "A channel about made-up things.",
      keywords: 'made "made up" things',
      country: "JP",
      defaultLanguage: "ja",
      unsubscribedTrailer: VIDEO,
      trackingAnalyticsAccountId: "UA-0000000-1",
      ...parts.channel,
    },
    image: { bannerExternalUrl: "https://yt3.ggpht.test/banner" },
    hints: [{ property: "channel.banner.mobile.medium.url", value: "https://yt3.ggpht.test/mobile" }],
  },
  localizations: parts.localizations ?? { en: { title: CHANNEL_TITLE, description: "About made-up things." } },
  contentDetails: { relatedPlaylists: { uploads: UPLOADS } },
})

/** `GET` of the label's own channel, answering the made-up one as `id`, or `channel` as it is. */
export const channelHandler = (id = CHANNEL, channel: unknown = { ...writableChannel(), id }): FakeHandler =>
  respond(CHANNELS_URL, { json: { items: [channel] } })

/** `PUT` of a channel part, answering `reply`; by default Google reports exactly the body it was sent. */
export const channelUpdateHandler = (
  reply: FakeHandler["reply"] = (request) => ({ json: request.json }),
): FakeHandler => ({
  method: "PUT",
  url: CHANNELS_URL,
  reply,
})

/** The addresses of the watermark upload and of its removal. */
export const WATERMARKS_SET_URL = "https://www.googleapis.com/upload/youtube/v3/watermarks/set"
export const WATERMARKS_UNSET_URL = "https://youtube.googleapis.com/youtube/v3/watermarks/unset"

/** `POST` of the watermark upload, answering `reply`; by default Google's 204. */
export const watermarkSetHandler = (reply: FakeHandler["reply"] = { status: 204 }): FakeHandler => ({
  method: "POST",
  url: WATERMARKS_SET_URL,
  reply,
})

/** `POST` of the watermark removal, answering `reply`; by default Google's 204. */
export const watermarkUnsetHandler = (reply: FakeHandler["reply"] = { status: 204 }): FakeHandler => ({
  method: "POST",
  url: WATERMARKS_UNSET_URL,
  reply,
})

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

/** The address of the caption upload, which an insert and an update with a file go to. */
export const CAPTION_UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/captions"

/** Made-up ids of the caption tracks of the made-up video: a published English one, a Japanese draft and the automatic one. */
export const TRACK = "cap_en_0001"
export const TRACK_DRAFT = "cap_ja_0002"
export const TRACK_ASR = "cap_asr_0003"

/** The id of the track the made-up insert makes. */
export const NEW_TRACK = "cap_new_0004"

/** A caption track as `captions.list` gives it with the part `snippet`; `snippet` is laid over the made-up one. */
export const captionTrack = (id: string, snippet: Record<string, unknown> = {}) => ({
  id,
  snippet: {
    videoId: VIDEO,
    lastUpdated: "2026-03-05T08:00:00Z",
    trackKind: "standard",
    language: "en",
    name: "English",
    isDraft: false,
    status: "serving",
    ...snippet,
  },
})

/** The tracks the made-up video has unless a test says otherwise. */
const TRACKS = [
  captionTrack(TRACK),
  captionTrack(TRACK_DRAFT, { language: "ja", name: "日本語", isDraft: true }),
  captionTrack(TRACK_ASR, { trackKind: "asr", name: "" }),
]

/** `GET` of the video's caption list, answering the tracks given: the made-up three by default. */
export const captionsHandler = (...tracks: unknown[]): FakeHandler =>
  respond(CAPTIONS_URL, { json: { items: tracks.length === 0 ? TRACKS : tracks } })

/** `POST` of the caption upload, answering `reply`; by default the new track, whose language and name the metadata gave. */
export const captionInsertHandler = (
  reply: FakeHandler["reply"] = (request) => {
    const { snippet } = relatedParts(request)[0]!.json as { snippet: Record<string, unknown> }
    return { json: captionTrack(NEW_TRACK, snippet) }
  },
): FakeHandler => ({ method: "POST", url: CAPTION_UPLOAD_URL, reply })

/** `PUT` of the caption upload, answering `reply`; by default the track the metadata names, with its draft state and the time of the change. */
export const captionUpdateMediaHandler = (
  reply: FakeHandler["reply"] = (request) => {
    const { id, snippet } = relatedParts(request)[0]!.json as { id: string; snippet: Record<string, unknown> }
    return { json: captionTrack(id, { ...snippet, lastUpdated: "2026-04-01T00:00:00Z" }) }
  },
): FakeHandler => ({ method: "PUT", url: CAPTION_UPLOAD_URL, reply })

/** `PUT` of the caption track alone, answering `reply`; by default the track the body names, with its draft state and the time of the change. */
export const captionUpdateHandler = (
  reply: FakeHandler["reply"] = (request) => {
    const { id, snippet } = request.json as { id: string; snippet: Record<string, unknown> }
    return { json: captionTrack(id, { ...snippet, lastUpdated: "2026-04-01T00:00:00Z" }) }
  },
): FakeHandler => ({ method: "PUT", url: CAPTIONS_URL, reply })

/** Made-up ids of the comments the made-up video has: a second thread, and a reply to the first. */
export const OTHER_THREAD = "UgxMadeUpThreadId0002"
export const REPLY = `${THREAD}.MadeUpReplyId01`

/** The id of the reply the made-up insert makes. */
export const NEW_REPLY = `${THREAD}.MadeUpNewReply`

/** A thread's top-level comment as `comments.list` gives it: on the made-up video, published, by someone else. */
export const topComment = (id = THREAD, text = "A made-up comment.", snippet: Record<string, unknown> = {}) =>
  commentResource(id, text, { videoId: VIDEO, moderationStatus: "published", ...snippet })

/** A reply as `comments.list` gives it: no video, but its thread. */
export const replyComment = (id = REPLY, text = "A made-up reply.", snippet: Record<string, unknown> = {}) =>
  commentResource(id, text, { parentId: THREAD, authorDisplayName: "Another one", ...snippet })

/** A thread as `commentThreads.list` gives it with `snippet`; `snippet` is laid over the made-up one. */
export const threadResource = (id = THREAD, text = "A made-up comment.", snippet: Record<string, unknown> = {}) => ({
  id,
  snippet: { videoId: VIDEO, canReply: true, topLevelComment: topComment(id, text), totalReplyCount: 0, ...snippet },
})

/** What a handler for a list by `id` answers: the items whose ids the request asks for. */
const askedFor = (items: { id: string }[]) => (request: FakeRequest) => ({
  json: { items: items.filter(({ id }) => request.url.searchParams.get("id")?.split(",").includes(id)) },
})

/** `GET` of the comment list, answering the comments given among those asked for by `id`: the made-up thread's comment, another thread's and a reply by default. */
export const commentsHandler = (...comments: { id: string }[]): FakeHandler =>
  respond(
    COMMENTS_URL,
    askedFor(
      comments.length === 0 ? [topComment(), topComment(OTHER_THREAD, "Another comment."), replyComment()] : comments,
    ),
  )

/** `GET` of the thread list, answering the threads given among those asked for by `id`: the two made-up ones by default. */
export const threadsHandler = (...threads: { id: string }[]): FakeHandler =>
  respond(
    COMMENT_THREADS_URL,
    askedFor(threads.length === 0 ? [threadResource(), threadResource(OTHER_THREAD, "Another comment.")] : threads),
  )

/** `POST` of a reply, answering `reply`; by default a reply with the parent and the text the body gave. */
export const commentInsertHandler = (
  reply: FakeHandler["reply"] = (request) => {
    const { snippet } = request.json as { snippet: { parentId: string; textOriginal: string } }
    return {
      json: commentResource(`${snippet.parentId}.MadeUpNewReply`, snippet.textOriginal, { parentId: snippet.parentId }),
    }
  },
): FakeHandler => ({ method: "POST", url: COMMENTS_URL, reply })

/** `POST` of a moderation, answering `reply`; by default Google's 204. */
export const moderateHandler = (reply: FakeHandler["reply"] = { status: 204 }): FakeHandler => ({
  method: "POST",
  url: `${COMMENTS_URL}/setModerationStatus`,
  reply,
})

/** The title of the made-up playlist. */
export const PLAYLIST_TITLE = "A made-up playlist"

/** Made-up ids: another channel's playlist, the playlist the made-up insert makes, and the entries of the made-up playlist. */
export const OTHER_PLAYLIST = "PLotherMadeUpPlay01"
export const NEW_PLAYLIST = "PLnewMadeUpPlaylist1"
export const ITEM = "UExtYWRlVXBFbnRyeTAwMDE"
export const OTHER_ITEM = "UExtYWRlVXBFbnRyeTAwMDI"

/** The id of the entry the made-up insert makes. */
export const NEW_ITEM = "UExtYWRlVXBFbnRyeU5ldw"

type PlaylistParts = Parts & { contentDetails?: Record<string, unknown> }

/**
 * The made-up playlist as `playlists.list` gives it with `snippet`, `status`,
 * `localizations` and `contentDetails`: public, of the label's channel, English,
 * with a Japanese localization, three entries and fields the tools never send.
 * Each part in `parts` is laid over its own.
 */
export const writablePlaylist = (parts: PlaylistParts = {}) => ({
  id: PLAYLIST,
  snippet: {
    publishedAt: "2026-03-01T09:00:00Z",
    channelId: CHANNEL,
    title: PLAYLIST_TITLE,
    description: "About made-up things.",
    thumbnails: { default: { url: "https://i.ytimg.test/default.jpg" } },
    channelTitle: "Made-up channel",
    defaultLanguage: "en",
    ...parts.snippet,
  },
  status: { privacyStatus: "public", podcastStatus: "unspecified", ...parts.status },
  localizations: parts.localizations ?? { ja: { title: "作り話の再生リスト", description: "作り話です。" } },
  contentDetails: { itemCount: 3, ...parts.contentDetails },
})

/**
 * An entry of the made-up playlist as `playlistItems.list` gives it with
 * `snippet` and `contentDetails`: the made-up video at position 1, with no
 * note. Each part in `parts` is laid over its own.
 */
export const playlistEntry = (
  id = ITEM,
  parts: { snippet?: Record<string, unknown>; contentDetails?: Record<string, unknown> } = {},
) => ({
  id,
  snippet: {
    playlistId: PLAYLIST,
    position: 1,
    title: TITLE,
    resourceId: { kind: "youtube#video", videoId: VIDEO },
    channelId: CHANNEL,
    ...parts.snippet,
  },
  contentDetails: { videoId: VIDEO, ...parts.contentDetails },
})

/** `GET` of the playlist list, answering the playlists given: the made-up one by default. */
export const playlistHandler = (...playlists: unknown[]): FakeHandler =>
  respond(PLAYLISTS_URL, { json: { items: playlists.length === 0 ? [writablePlaylist()] : playlists } })

/** `GET` of the playlist entry list, answering the entries given among those asked for by `id`: the made-up one and another by default. */
export const playlistEntriesHandler = (...entries: { id: string }[]): FakeHandler =>
  respond(
    PLAYLIST_ITEMS_URL,
    askedFor(
      entries.length === 0 ? [playlistEntry(), playlistEntry(OTHER_ITEM, { snippet: { position: 2 } })] : entries,
    ),
  )

/** `POST` of a playlist, answering `reply`; by default the playlist the body gave, made with the id `NEW_PLAYLIST`. */
export const playlistInsertHandler = (
  reply: FakeHandler["reply"] = (request) => ({ json: { id: NEW_PLAYLIST, ...(request.json as object) } }),
): FakeHandler => ({ method: "POST", url: PLAYLISTS_URL, reply })

/** `PUT` of a playlist, answering `reply`; by default Google reports exactly the body it was sent. */
export const playlistUpdateHandler = (
  reply: FakeHandler["reply"] = (request) => ({ json: request.json }),
): FakeHandler => ({
  method: "PUT",
  url: PLAYLISTS_URL,
  reply,
})

/** `POST` of an entry, answering `reply`; by default the entry the body gave, made with the id `NEW_ITEM` and, with no position given, at position 3. */
export const entryInsertHandler = (
  reply: FakeHandler["reply"] = (request) => {
    const { snippet } = request.json as { snippet: Record<string, unknown> }
    return { json: { id: NEW_ITEM, snippet: { position: 3, ...snippet } } }
  },
): FakeHandler => ({ method: "POST", url: PLAYLIST_ITEMS_URL, reply })

/** `PUT` of an entry, answering `reply`; by default Google reports exactly the body it was sent. */
export const entryUpdateHandler = (
  reply: FakeHandler["reply"] = (request) => ({ json: request.json }),
): FakeHandler => ({
  method: "PUT",
  url: PLAYLIST_ITEMS_URL,
  reply,
})

/** `DELETE` of an entry, answering `reply`; by default Google's 204. */
export const entryDeleteHandler = (reply: FakeHandler["reply"] = { status: 204 }): FakeHandler => ({
  method: "DELETE",
  url: PLAYLIST_ITEMS_URL,
  reply,
})

/** One part of a `multipart/related` body: its content type, its bytes and, for JSON, its value. */
export type RelatedPart = { type: string; bytes: Buffer; json?: unknown }

/** The parts of the `multipart/related` body of `request`, in order, split at the boundary its `Content-Type` names. */
export function relatedParts(request: FakeRequest): RelatedPart[] {
  const boundary = /boundary="([^"]+)"/.exec(request.headers["content-type"] ?? "")![1]!
  const crlf = "\r\n"
  const body = Buffer.from(request.bytes!)
  const first = Buffer.from(`--${boundary}${crlf}`)
  const between = Buffer.from(`${crlf}--${boundary}${crlf}`)
  const last = Buffer.from(`${crlf}--${boundary}--${crlf}`)
  const parts: RelatedPart[] = []
  let rest = body.subarray(first.length, body.length - last.length)
  for (;;) {
    const end = rest.indexOf(between)
    const part = end === -1 ? rest : rest.subarray(0, end)
    const split = part.indexOf(`${crlf}${crlf}`)
    const type = /^Content-Type: (.*)$/im.exec(part.subarray(0, split).toString())![1]!
    const content = part.subarray(split + 4)
    parts.push({
      type,
      bytes: content,
      ...(type.startsWith("application/json") && { json: JSON.parse(content.toString()) }),
    })
    if (end === -1) return parts
    rest = rest.subarray(end + between.length)
  }
}

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
    [
      ...(options.handlers ?? []),
      channelHandler(),
      channelUpdateHandler(),
      watermarkSetHandler(),
      watermarkUnsetHandler(),
      videoHandler(),
      updateHandler(),
      thumbnailHandler(),
      captionsHandler(),
      captionInsertHandler(),
      captionUpdateMediaHandler(),
      captionUpdateHandler(),
      commentsHandler(),
      threadsHandler(),
      commentInsertHandler(),
      moderateHandler(),
      playlistHandler(),
      playlistEntriesHandler(),
      playlistInsertHandler(),
      playlistUpdateHandler(),
      entryInsertHandler(),
      entryUpdateHandler(),
      entryDeleteHandler(),
    ],
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
    captionAdd: bound(googleYoutubeCaptionAdd, ctx, { video: VIDEO, language: "en" }),
    captionUpdate: bound(googleYoutubeCaptionUpdate, ctx, { video: VIDEO, caption: TRACK }),
    commentReply: bound(googleYoutubeCommentReply, ctx, { thread: THREAD, text: "Thanks for watching!" }),
    commentModerate: bound(googleYoutubeCommentModerate, ctx, { comments: [THREAD], moderation: "publish" }),
    commentReject: bound(googleYoutubeCommentReject, ctx, { comments: [THREAD] }),
    playlistCreate: bound(googleYoutubePlaylistCreate, ctx, { title: "A new playlist" }),
    playlistEdit: bound(googleYoutubePlaylistEdit, ctx, { playlist: PLAYLIST }),
    playlistAdd: bound(googleYoutubePlaylistAdd, ctx, { playlist: PLAYLIST, video: VIDEO }),
    playlistMove: bound(googleYoutubePlaylistMove, ctx, { playlist: PLAYLIST, item: ITEM, position: 0 }),
    playlistRemove: bound(googleYoutubePlaylistRemove, ctx, { playlist: PLAYLIST, item: ITEM }),
    playlistPrivacy: bound(googleYoutubePrivacySet, ctx, { playlist: PLAYLIST }),
    channelEdit: bound(googleYoutubeChannelEdit, ctx, {}),
    watermarkSet: bound(googleYoutubeWatermarkSet, ctx, {}),
    watermarkRemove: bound(googleYoutubeWatermarkRemove, ctx, {}),
    /** The requests that changed something. */
    writes: () => h.calls().filter((request) => request.method !== "GET"),
    /** What the fake received, as `METHOD url`. */
    lines: () => h.calls().map(requestLine),
  }
}

export type WriteFixture = Awaited<ReturnType<typeof writeFixture>>
