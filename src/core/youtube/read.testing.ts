import { CREDENTIAL } from "../google/client.fixtures"
import type { Credential } from "../google/credentials"
import type { FakeHandler, FakeReply } from "../google/fake-google.testing"
import { fixture as sheetsFixture } from "../sheets/read.testing"
import { invoke } from "../tool"
import { googleYoutubeRead } from "./read"
import { YOUTUBE_ANALYTICS_READ_SCOPE, YOUTUBE_READ_SCOPE, YOUTUBE_SCOPE } from "./scopes"

/** Fixtures the YouTube read tests share: the state directory and fake Google of the Sheets fixtures, with a label logged in for YouTube and the YouTube read as the tool. */

export { answer, cleanUp, freshTokens } from "../sheets/read.testing"

/** What a label logged in for the youtube toolset holds: the read scopes and `youtube.force-ssl`. */
export const YOUTUBE_CREDENTIAL: Credential = {
  ...CREDENTIAL,
  scopes: [...CREDENTIAL.scopes, YOUTUBE_READ_SCOPE, YOUTUBE_ANALYTICS_READ_SCOPE, YOUTUBE_SCOPE],
}

/** What a label logged in for the youtube toolset with `--read-only` holds: the read scopes alone. */
export const READ_ONLY_CREDENTIAL: Credential = {
  ...CREDENTIAL,
  scopes: [...CREDENTIAL.scopes, YOUTUBE_READ_SCOPE, YOUTUBE_ANALYTICS_READ_SCOPE],
}

/** Made-up ids, shaped as Google writes them. */
export const VIDEO = "abcDEFghi_1"
export const OTHER_VIDEO = "xyzXYZ-0123"
export const CHANNEL = "UCmadeUpChannelId0123456"
export const OTHER_CHANNEL = "UCotherMadeUpChanId01234"
export const PLAYLIST = "PLmadeUpPlaylist01"
export const THREAD = "UgxMadeUpThreadId0001"

const DATA_API = "https://youtube.googleapis.com/youtube/v3"
export const SEARCH_URL = `${DATA_API}/search`
export const VIDEOS_URL = `${DATA_API}/videos`
export const CHANNELS_URL = `${DATA_API}/channels`
export const PLAYLISTS_URL = `${DATA_API}/playlists`
export const PLAYLIST_ITEMS_URL = `${DATA_API}/playlistItems`
export const COMMENT_THREADS_URL = `${DATA_API}/commentThreads`
export const COMMENTS_URL = `${DATA_API}/comments`

/** What the fake Google received other than the token refresh, as `METHOD url` without its query. */
export const requestLine = (request: { method: string; url: URL }) =>
  `${request.method} ${request.url.origin}${request.url.pathname}`

/** What Google answers with for a refused call: an error body in its shape, with the `reason` of the first error. */
export const refusal = (status: number, reason: string, message = "Refused."): FakeReply => ({
  status,
  json: { error: { code: status, message, errors: [{ reason, message }] } },
})

/** A GET handler for `url` that answers with `reply` and sees the request. */
export const respond = (url: FakeHandler["url"], reply: FakeHandler["reply"]): FakeHandler => ({
  method: "GET",
  url,
  reply,
})

/** A video as `videos.list` gives it. */
export const videoResource = (id = VIDEO, extra: Record<string, unknown> = {}) => ({
  id,
  snippet: {
    title: "A made-up video",
    description: "About made-up things.",
    publishedAt: "2026-03-01T09:00:00Z",
    channelId: CHANNEL,
    channelTitle: "Made-up channel",
    tags: ["made", "up"],
    liveBroadcastContent: "none",
  },
  contentDetails: { duration: "PT4M13S" },
  statistics: { viewCount: "1200", likeCount: "34", commentCount: "5" },
  status: { privacyStatus: "public", madeForKids: false },
  ...extra,
})

/** A channel as `channels.list` gives it. */
export const channelResource = (id = CHANNEL, extra: Record<string, unknown> = {}) => ({
  id,
  snippet: {
    title: "Made-up channel",
    customUrl: "@madeup",
    description: "A channel about made-up things.",
    publishedAt: "2020-01-02T03:04:05Z",
    country: "JP",
  },
  statistics: { subscriberCount: "1500", hiddenSubscriberCount: false, videoCount: "42", viewCount: "99000" },
  contentDetails: { relatedPlaylists: { uploads: "UUmadeUpChannelId0123456" } },
  ...extra,
})

/** A comment as `comments.list` gives it, and as a thread holds it. */
export const commentResource = (id: string, text = "A made-up comment.", extra: Record<string, unknown> = {}) => ({
  id,
  snippet: {
    authorDisplayName: "Someone",
    authorChannelId: { value: OTHER_CHANNEL },
    textDisplay: text,
    textOriginal: text,
    likeCount: 3,
    publishedAt: "2026-03-02T10:00:00Z",
    updatedAt: "2026-03-02T11:00:00Z",
    ...extra,
  },
})

/** The fixtures with a label logged in for YouTube, and `read` calling the YouTube read. */
export async function fixture(
  handlers: FakeHandler[] = [],
  credential: Credential | null = YOUTUBE_CREDENTIAL,
  env: Record<string, string> = {},
) {
  const h = await sheetsFixture(handlers, credential, env)
  return { ...h, read: (args: unknown) => invoke(googleYoutubeRead, args, h.ctx) }
}

export type Fixture = Awaited<ReturnType<typeof fixture>>

/** The query of the first request the fake received other than the token refresh, as an object. */
export const queryOf = (h: Fixture, index = 0) => Object.fromEntries(h.calls()[index]!.url.searchParams)
