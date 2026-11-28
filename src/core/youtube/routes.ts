import type { Route } from "../google/routes"
import { YOUTUBE_ANALYTICS_READ_SCOPE, YOUTUBE_READ_SCOPE, YOUTUBE_SCOPE } from "./scopes"

const YOUTUBE_HOST = "youtube.googleapis.com"
const ANALYTICS_HOST = "youtubeanalytics.googleapis.com"
const UPLOAD_HOST = "www.googleapis.com"

/** Every Data API path starts with this prefix. */
const DATA_PATH = "/youtube/v3"

/** The scopes that read public data, narrowest first. */
const READ_SCOPES = [YOUTUBE_READ_SCOPE, YOUTUBE_SCOPE] as const

/** Google serves comments and caption tracks, and takes every write, only with `youtube.force-ssl`. */
const FORCE_SSL_SCOPES = [YOUTUBE_SCOPE] as const

/** The calls the YouTube tools may make, each with every scope that allows it, narrowest first. */
export const YOUTUBE_ROUTES = {
  search: { method: "GET", host: YOUTUBE_HOST, path: `${DATA_PATH}/search`, scopes: READ_SCOPES },
  videos: { method: "GET", host: YOUTUBE_HOST, path: `${DATA_PATH}/videos`, scopes: READ_SCOPES },
  channels: { method: "GET", host: YOUTUBE_HOST, path: `${DATA_PATH}/channels`, scopes: READ_SCOPES },
  playlists: { method: "GET", host: YOUTUBE_HOST, path: `${DATA_PATH}/playlists`, scopes: READ_SCOPES },
  playlistItems: { method: "GET", host: YOUTUBE_HOST, path: `${DATA_PATH}/playlistItems`, scopes: READ_SCOPES },
  commentThreads: { method: "GET", host: YOUTUBE_HOST, path: `${DATA_PATH}/commentThreads`, scopes: FORCE_SSL_SCOPES },
  comments: { method: "GET", host: YOUTUBE_HOST, path: `${DATA_PATH}/comments`, scopes: FORCE_SSL_SCOPES },
  captions: { method: "GET", host: YOUTUBE_HOST, path: `${DATA_PATH}/captions`, scopes: FORCE_SSL_SCOPES },
  /** `videos.update`, which replaces every writable property of the parts it is sent. */
  videosUpdate: { method: "PUT", host: YOUTUBE_HOST, path: `${DATA_PATH}/videos`, scopes: FORCE_SSL_SCOPES },
  /** `thumbnails.set`, which takes the image as the raw body of an upload. */
  thumbnailsSet: {
    method: "POST",
    host: UPLOAD_HOST,
    path: `/upload${DATA_PATH}/thumbnails/set`,
    scopes: FORCE_SSL_SCOPES,
  },
  /** `videos.insert` as a resumable upload: the start of the session, which names the video. */
  videosInsert: {
    method: "POST",
    host: UPLOAD_HOST,
    path: `/upload${DATA_PATH}/videos`,
    scopes: FORCE_SSL_SCOPES,
  },
  /** The chunks of a `videos.insert` session, sent to the address the start answered with. */
  videosInsertChunk: {
    method: "PUT",
    host: UPLOAD_HOST,
    path: `/upload${DATA_PATH}/videos`,
    scopes: FORCE_SSL_SCOPES,
  },
  /** `captions.insert` as a multipart upload: the track's metadata and its file in one request. */
  captionsInsert: {
    method: "POST",
    host: UPLOAD_HOST,
    path: `/upload${DATA_PATH}/captions`,
    scopes: FORCE_SSL_SCOPES,
  },
  /** `captions.update` as a multipart upload, for a track given a new file. */
  captionsUpdateMedia: {
    method: "PUT",
    host: UPLOAD_HOST,
    path: `/upload${DATA_PATH}/captions`,
    scopes: FORCE_SSL_SCOPES,
  },
  /** `captions.update` with no file, which changes the track's draft state alone. */
  captionsUpdate: { method: "PUT", host: YOUTUBE_HOST, path: `${DATA_PATH}/captions`, scopes: FORCE_SSL_SCOPES },
  /** `comments.insert`, which here makes a reply to a thread. */
  commentsInsert: { method: "POST", host: YOUTUBE_HOST, path: `${DATA_PATH}/comments`, scopes: FORCE_SSL_SCOPES },
  /** `comments.setModerationStatus`, which publishes, holds or rejects the comments of the `id` query and answers 204. */
  commentsModerate: {
    method: "POST",
    host: YOUTUBE_HOST,
    path: `${DATA_PATH}/comments/setModerationStatus`,
    scopes: FORCE_SSL_SCOPES,
  },
  /** `reports.query` of the Analytics API. */
  analytics: {
    method: "GET",
    host: ANALYTICS_HOST,
    path: "/v2/reports",
    scopes: [YOUTUBE_ANALYTICS_READ_SCOPE, YOUTUBE_READ_SCOPE],
  },
} as const satisfies Record<string, Route>
