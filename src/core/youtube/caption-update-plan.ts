import { ToolError } from "../errors"
import type { GoogleSession } from "../google/session"
import type { ToolContext } from "../tool"
import type { YoutubeCaptionUpdateArgs } from "./caption-args"
import { trackList, type CaptionRequest } from "./caption-calls"
import { readCaptionFile, type CaptionFile } from "./caption-file"
import type { CaptionView } from "./caption-view"
import { refusal } from "./checks"
import { captionId, videoId } from "./ids"
import { ownVideo } from "./own-video"
import { YOUTUBE_ROUTES } from "./routes"
import type { VideoState } from "./video-state"
import { youtubeWriteSession } from "./write-session"

/** The kind of track YouTube makes by itself from the audio, which cannot be replaced. */
const AUTOMATIC_KIND = "asr"

/** A caption update planned: the video and the track as they were read, the file if one goes, and what is sent. */
export type CaptionUpdatePlan = {
  session: GoogleSession
  video: string
  /** The video as it was read. */
  state: VideoState
  /** The track as it was read. */
  track: CaptionView
  /** The new file, when the call gives one. */
  file: CaptionFile | undefined
  /** Whether the track is a draft after the call. */
  draft: boolean
  request: CaptionRequest
}

/**
 * Checks the arguments (the ids, at least one of `path` and `draft`) and the
 * label's scopes before anything is read, then reads the caption file when
 * one is given, the label's channel and the video, which must be the
 * channel's own, and the video's caption tracks: the track must be one of
 * them (`not_found` otherwise) and not YouTube's automatic one
 * (`invalid_argument`), and the call must change something.
 */
export async function planCaptionUpdate(args: YoutubeCaptionUpdateArgs, ctx: ToolContext): Promise<CaptionUpdatePlan> {
  const video = videoId(args.video)
  const caption = captionId(args.caption)
  if (args.path === undefined && args.draft === undefined) {
    throw refusal("Give `path`, `draft` or both: there is nothing to change otherwise")
  }
  const route = args.path === undefined ? YOUTUBE_ROUTES.captionsUpdate : YOUTUBE_ROUTES.captionsUpdateMedia
  const session = await youtubeWriteSession(ctx, args.account, route)
  const file = args.path === undefined ? undefined : await readCaptionFile(args.path, ctx)
  const { state } = await ownVideo(session, video)
  const track = (await trackList(session, video)).find((candidate) => candidate.caption_id === caption)
  if (track === undefined) {
    throw new ToolError(
      "not_found",
      `Caption track ${caption} is not one of the video's caption tracks; \`google_youtube_read\` method \`captions\` lists them.`,
    )
  }
  if (track.kind === AUTOMATIC_KIND) {
    throw refusal(`Caption track ${caption} is YouTube's automatic track, which cannot be replaced or changed`)
  }
  const draft = args.draft ?? track.draft ?? false
  if (file === undefined && draft === (track.draft ?? false)) {
    throw refusal(`The caption track is already ${draft ? "a draft" : "published"}, so there is nothing to change`)
  }
  return {
    session,
    video,
    state,
    track,
    file,
    draft,
    request: { route, metadata: { id: caption, snippet: { isDraft: draft } }, ...(file !== undefined && { file }) },
  }
}
