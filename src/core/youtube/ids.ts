import { ToolError } from "../errors"
import { shown } from "../run/ids"

/** A video id: 11 letters, digits, `_` and `-`. */
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/

/** A channel id: `UC` and 22 letters, digits, `_` and `-`. */
const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/

/** A channel handle: `@` and 3 to 30 letters, digits, `.`, `_` and `-`. */
const HANDLE_PATTERN = /^@[A-Za-z0-9._-]{3,30}$/

/** A playlist id of any kind (`PL…`, `UU…`, `LL…`, `FL…`, `RD…`). */
const PLAYLIST_ID_PATTERN = /^[A-Za-z0-9_-]{2,64}$/

/** A comment id; a reply's id holds a `.`. */
const COMMENT_ID_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/

/** A caption track id, checked loosely: 8 to 300 letters, digits, `_`, `=`, `.` and `-`. */
const CAPTION_ID_PATTERN = /^[A-Za-z0-9_=.-]{8,300}$/

/** A page token as Google returns it. */
const PAGE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,256}$/

const YOUTUBE_HOST_PATTERN = /^(?:www\.|m\.)?youtube\.com$/
const SHORT_HOST = "youtu.be"

/** The first path segments whose second segment is a video id. */
const VIDEO_PATH_PREFIXES: ReadonlySet<string> = new Set(["shorts", "live"])

/** What a channel handle or id says of a channel in a `ChannelRef`. */
export type ChannelRef = { id: string; handle?: undefined } | { handle: string; id?: undefined }

function refusal(value: string, rule: string): ToolError {
  return new ToolError("invalid_argument", `${shown(value)} ${rule}`)
}

/** The URL `value` holds, when it is a YouTube or youtu.be address; else undefined. */
function youtubeUrl(value: string): URL | undefined {
  if (!/^https?:\/\//i.test(value)) return undefined
  try {
    const url = new URL(value)
    return YOUTUBE_HOST_PATTERN.test(url.hostname) || url.hostname === SHORT_HOST ? url : undefined
  } catch {
    return undefined
  }
}

function pathSegments(url: URL): string[] {
  return url.pathname.split("/").filter((segment) => segment !== "")
}

function videoIdInUrl(url: URL): string | undefined {
  const [first, second] = pathSegments(url)
  if (url.hostname === SHORT_HOST) return first
  if (first === "watch") return url.searchParams.get("v") ?? undefined
  return first !== undefined && VIDEO_PATH_PREFIXES.has(first) ? second : undefined
}

/** The video id of `value`, which is an id or a YouTube video address; else `invalid_argument`. */
export function videoId(value: string): string {
  const url = youtubeUrl(value)
  const id = url === undefined ? value : videoIdInUrl(url)
  if (id !== undefined && VIDEO_ID_PATTERN.test(id)) return id
  throw refusal(
    value,
    "is not a video id (11 letters, digits, `_` and `-`) or a YouTube video address such as `https://www.youtube.com/watch?v=ID`.",
  )
}

/** The channel of `value`, which is a `UC…` id, an `@handle` or a channel address: `{ id }` or `{ handle }`; else `invalid_argument`. */
export function channelRef(value: string): ChannelRef {
  const url = youtubeUrl(value)
  const [first, second] = url === undefined ? [value] : pathSegments(url)
  const candidate = first === "channel" ? second : first
  if (candidate !== undefined && (url === undefined || url.hostname !== SHORT_HOST)) {
    if (CHANNEL_ID_PATTERN.test(candidate)) return { id: candidate }
    if (HANDLE_PATTERN.test(candidate)) return { handle: candidate }
  }
  throw refusal(
    value,
    "is not a channel (a `UC…` id, an `@handle`, or a YouTube channel address such as `https://www.youtube.com/@handle`).",
  )
}

/** The playlist id of `value`, which is an id or an address with `list=`; else `invalid_argument`. */
export function playlistId(value: string): string {
  const url = youtubeUrl(value)
  const id = url === undefined ? value : (url.searchParams.get("list") ?? undefined)
  if (id !== undefined && PLAYLIST_ID_PATTERN.test(id)) return id
  throw refusal(value, "is not a playlist id or a YouTube address with `list=`.")
}

/** `value` when it is a comment id, else `invalid_argument`. */
export function commentId(value: string): string {
  if (COMMENT_ID_PATTERN.test(value)) return value
  throw refusal(value, "is not a comment id.")
}

/** `value` when it is shaped like a caption track id, as `google_youtube_read` method `captions` gives it, else `invalid_argument`. */
export function captionId(value: string): string {
  if (CAPTION_ID_PATTERN.test(value)) return value
  throw refusal(value, "is not a caption track id (as `google_youtube_read` method `captions` gives it).")
}

/** `value` when it is a page token, else `invalid_argument`. */
export function pageToken(value: string): string {
  if (PAGE_TOKEN_PATTERN.test(value)) return value
  throw refusal(value, "is not a page token.")
}
