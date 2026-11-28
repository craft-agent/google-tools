import type { GoogleSession } from "../google/session"
import type { ToolContext } from "../tool"
import type { YoutubeCaptionAddArgs } from "./caption-args"
import { trackList, type CaptionRequest } from "./caption-calls"
import { readCaptionFile, type CaptionFile } from "./caption-file"
import { checkedCaptionName, checkedLanguage } from "./checks"
import { videoId } from "./ids"
import { ownVideo } from "./own-video"
import { YOUTUBE_ROUTES } from "./routes"
import type { VideoState } from "./video-state"
import { youtubeWriteSession } from "./write-session"

/** A new caption track planned: the video as it was read, the file, what the video holds in the language already, and what is sent. */
export type CaptionAddPlan = {
  session: GoogleSession
  video: string
  /** The video as it was read. */
  state: VideoState
  file: CaptionFile
  language: string
  draft: boolean
  /** How many caption tracks of the video are in `language` already, whatever their names. */
  inLanguage: number
  request: CaptionRequest & { file: CaptionFile }
}

/**
 * Checks the arguments (the video's id, the language, the name) and the
 * label's scopes before anything is read, then reads the caption file under
 * the upload rules (see `readCaptionFile`), the label's channel and the video,
 * which must be the channel's own, and the video's caption tracks.
 */
export async function planCaptionAdd(args: YoutubeCaptionAddArgs, ctx: ToolContext): Promise<CaptionAddPlan> {
  const video = videoId(args.video)
  const language = checkedLanguage(args.language, "`language`")
  const name = checkedCaptionName(args.name ?? "")
  const draft = args.draft ?? false
  const session = await youtubeWriteSession(ctx, args.account, YOUTUBE_ROUTES.captionsInsert)
  const file = await readCaptionFile(args.path, ctx)
  const { state } = await ownVideo(session, video)
  const tracks = await trackList(session, video)
  return {
    session,
    video,
    state,
    file,
    language,
    draft,
    inLanguage: tracks.filter((track) => track.language?.toLowerCase() === language.toLowerCase()).length,
    request: {
      route: YOUTUBE_ROUTES.captionsInsert,
      metadata: { snippet: { videoId: video, language, name, isDraft: draft } },
      file,
    },
  }
}
