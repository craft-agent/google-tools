import { ToolError } from "../errors"
import { shown } from "../run/ids"
import { parseReply } from "../sheets/reply"
import { listVideos } from "./calls"
import { repliesList, threadsList } from "./comment-view"
import { youtubeError } from "./errors"
import { threadOf } from "./ids"
import { ownChannel, type OwnSession } from "./own-calls"
import { YOUTUBE_ROUTES } from "./routes"
import type { VideoStatus } from "./video-state"

/** The parts of the videos a comment write reads: the title and the channel for the prompt, the privacy for who sees the comment. */
const COMMENT_VIDEO_PARTS = "snippet,status"

/** What a comment's text and thread are asked for in: plain text, which is what the prompt shows. */
const TEXT_FORMAT = "plainText"

/** A comment of the label's own channel's videos, as the moderation prompt shows it and pins it. */
export type OwnComment = {
  id: string
  author: string | null
  text: string
  /** `published`, `heldForReview` or `rejected` when Google says. */
  moderation: string | null
  /** The id of the video the comment is on. */
  video: string
}

/** A video the comments are on: its title and who can watch it. */
export type CommentVideo = { id: string; title: string; status: VideoStatus }

/** The comments asked for, in the order given, and the distinct videos they are on, in the order of the comments. */
export type OwnComments = { comments: OwnComment[]; videos: CommentVideo[] }

/** The comments of `ids` as `comments.list` gives them with the part `snippet`; the ones Google did not return are left out. */
async function listComments(session: OwnSession, ids: readonly string[]) {
  try {
    const reply = await session.client.request(YOUTUBE_ROUTES.comments, {
      query: { part: "snippet", id: ids.join(","), textFormat: TEXT_FORMAT },
    })
    return parseReply(repliesList, reply, "the comments").items ?? []
  } catch (error) {
    throw youtubeError(error)
  }
}

/** The threads of `ids` as `commentThreads.list` gives them with the part `snippet`; the ones Google did not return are left out. */
export async function listThreads(session: OwnSession, ids: readonly string[]) {
  try {
    const reply = await session.client.request(YOUTUBE_ROUTES.commentThreads, {
      query: { part: "snippet", id: ids.join(","), textFormat: TEXT_FORMAT },
    })
    return parseReply(threadsList, reply, "the comment threads").items ?? []
  } catch (error) {
    throw youtubeError(error)
  }
}

/** A sentence that says the `what` of `ids` that are not among `found` were not found, or nothing when all are. */
function namedMissing(what: string, ids: readonly string[], found: ReadonlySet<string>): string | undefined {
  const missing = ids.filter((id) => !found.has(id))
  if (missing.length === 0) return undefined
  return `${what} ${missing.map(shown).join(", ")} ${missing.length === 1 ? "was" : "were"} not found, or the account cannot see ${missing.length === 1 ? "it" : "them"}.`
}

/** The failure of a comment whose video neither it nor its thread tells. */
function unplaced(id: string): ToolError {
  return new ToolError("upstream_error", `Google did not say which video comment ${shown(id)} is on.`)
}

/** The id of the thread of the comment `id`: a reply's `parentId`, else the part of its id before the `.`, else, for a top-level comment, its own id. */
function threadIdOf(id: string, parentId: string | undefined): string {
  return parentId ?? threadOf(id)
}

/**
 * The video each of the comments is on: the comment's `videoId` when Google
 * gives it, else its thread's, read with `commentThreads.list`; Google gives
 * no `videoId` in `comments.list`, for a top-level comment as for a reply, so
 * the thread is read for both. A comment or a thread Google does not return
 * is `not_found`.
 */
async function videosOfComments(session: OwnSession, ids: readonly string[]): Promise<OwnComment[]> {
  const listed = await listComments(session, ids)
  const byId = new Map(listed.map((comment) => [comment.id, comment]))
  const absent = namedMissing("Comment", ids, new Set(byId.keys()))
  if (absent !== undefined) throw new ToolError("not_found", absent)

  const parents = new Map<string, string>()
  for (const id of ids) {
    const { snippet } = byId.get(id)!
    if (snippet?.videoId === undefined) parents.set(id, threadIdOf(id, snippet?.parentId))
  }
  const threadIds = [...new Set(parents.values())]
  const threadVideos = new Map<string, string | undefined>()
  if (threadIds.length > 0) {
    for (const thread of await listThreads(session, threadIds)) threadVideos.set(thread.id, thread.snippet?.videoId)
    const lost = namedMissing("Thread", threadIds, new Set(threadVideos.keys()))
    if (lost !== undefined) throw new ToolError("not_found", lost)
  }

  return ids.map((id) => {
    const { snippet } = byId.get(id)!
    const parent = parents.get(id)
    const video = snippet?.videoId ?? (parent === undefined ? undefined : threadVideos.get(parent))
    if (video === undefined) throw unplaced(id)
    return {
      id,
      author: snippet?.authorDisplayName ?? null,
      text: snippet?.textDisplay ?? snippet?.textOriginal ?? "",
      moderation: snippet?.moderationStatus ?? null,
      video,
    }
  })
}

/** The label's channel and the videos of `ids` as `videos.list` gives them with their title, channel and status. */
async function readVideos(session: OwnSession, ids: readonly string[]) {
  try {
    const channel = await ownChannel(session, "id")
    return { channel, videos: await listVideos(session.client, ids, COMMENT_VIDEO_PARTS) }
  } catch (error) {
    throw youtubeError(error)
  }
}

/**
 * The comments of `ids` (1 to 50) as the moderation plans with them, each with
 * its video, which must be the label's own channel's: a comment Google does not
 * return is `not_found`, naming the ids, and one on another channel's video is
 * `forbidden`, naming the video's title and id, so a prompt never shows another
 * channel's comment as its subject. Google's failures come out as
 * `youtubeError` makes them.
 */
export async function ownComments(session: OwnSession, ids: readonly string[]): Promise<OwnComments> {
  const comments = await videosOfComments(session, ids)
  const videoIds = [...new Set(comments.map(({ video }) => video))]
  const { channel, videos: listed } = await readVideos(session, videoIds)
  const byId = new Map(listed.map((video) => [video.id, video]))
  const lost = namedMissing("Video", videoIds, new Set(byId.keys()))
  if (lost !== undefined) throw new ToolError("not_found", lost)

  const foreign = videoIds
    .map((id) => byId.get(id)!)
    .filter(({ snippet }) => snippet?.channelId !== channel.id)
    .map(({ id, snippet }) => `${shown(snippet?.title ?? "")} (${id})`)
  if (foreign.length > 0) {
    throw new ToolError(
      "forbidden",
      `The comments are on ${foreign.join(", ")}, ${foreign.length === 1 ? "a video" : "videos"} of another channel; only comments on the channel's own videos can be changed. Nothing was sent.`,
    )
  }

  const videos = videoIds.map((id): CommentVideo => {
    const { snippet, status } = byId.get(id)!
    if (snippet?.title === undefined || status?.privacyStatus === undefined) {
      throw new ToolError("upstream_error", "Google's reply to the video list was not in the expected shape.")
    }
    return { id, title: snippet.title, status: { privacyStatus: status.privacyStatus, publishAt: status.publishAt } }
  })
  return { comments, videos }
}
