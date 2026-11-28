import { isAbsolute } from "node:path"
import type { Upload } from "../files/upload"
import type { GoogleSession } from "../google/session"
import type { ToolContext } from "../tool"
import { refusal } from "./checks"
import { readImage, type ImageKind } from "./image-file"
import { YOUTUBE_ROUTES } from "./routes"
import type { WatermarkAnchor, YoutubeWatermarkSetArgs } from "./watermark-args"
import { readWatermarkChannel, type WatermarkChannel } from "./watermark-channel"
import { youtubeWriteSession } from "./write-session"

/** The most bytes of a watermark, as Google counts them: 10 MB. */
export const MAX_WATERMARK_BYTES = 10 * 1000 * 1000

const MS_PER_SECOND = 1000

/** The `timing.type` of a watermark counted from the start and from the end of each video. */
const TIMING_TYPES = { start: "offsetFromStart", end: "offsetFromEnd" } as const

/** When a watermark is shown, as the call sets it: counted from the start or the end, in whole seconds. */
export type WatermarkTiming = {
  from: WatermarkAnchor
  offsetSeconds: number
  /** `null` for until the end of the video. */
  durationSeconds: number | null
}

/** A watermark planned: the label's channel, the image as read and hashed, and when it is shown. */
export type WatermarkSetPlan = {
  session: GoogleSession
  channel: WatermarkChannel
  /** The image: its real path, bytes and SHA-256. */
  file: Upload
  image: ImageKind
  timing: WatermarkTiming
}

/**
 * The timing `args` ask for: from the start with no offset and no duration, the
 * whole video, by default. Counted from the end, the offset is required and at
 * least 1 second, and a duration longer than it would run past the end of the
 * video.
 */
export function checkedTiming(args: YoutubeWatermarkSetArgs): WatermarkTiming {
  const from = args.from ?? "start"
  const { offset_seconds: offset, duration_seconds: duration } = args
  if (from === "end") {
    if (offset === undefined || offset < 1) {
      throw refusal("`offset_seconds` is required with `from` `end`, and must be at least 1")
    }
    if (duration !== undefined && duration > offset) {
      throw refusal(
        `\`duration_seconds\` (${duration}) must be at most \`offset_seconds\` (${offset}) with \`from\` \`end\``,
      )
    }
  }
  return { from, offsetSeconds: offset ?? 0, durationSeconds: duration ?? null }
}

/** The metadata of the upload: the timing, as Google names it, in milliseconds. */
export function watermarkMetadata({ from, offsetSeconds, durationSeconds }: WatermarkTiming): object {
  return {
    timing: {
      type: TIMING_TYPES[from],
      offsetMs: offsetSeconds * MS_PER_SECOND,
      ...(durationSeconds !== null && { durationMs: durationSeconds * MS_PER_SECOND }),
    },
  }
}

/**
 * Checks the arguments (the timing, an absolute path) and the label's scopes
 * before anything is read, then reads the image under the upload rules (a file
 * under `encrypt_dirs` is `forbidden`: YouTube would hold only ciphertext,
 * which no one could watch; an image that is not a JPEG or a PNG, by extension
 * and by its first bytes, is `invalid_argument`), then reads the label's
 * channel.
 */
export async function planWatermarkSet(args: YoutubeWatermarkSetArgs, ctx: ToolContext): Promise<WatermarkSetPlan> {
  const timing = checkedTiming(args)
  if (!isAbsolute(args.path)) throw refusal(`\`path\` "${args.path}" must be an absolute path`)
  const session = await youtubeWriteSession(ctx, args.account, YOUTUBE_ROUTES.watermarksSet)
  const { file, image } = await readImage(args.path, ctx, { maxBytes: MAX_WATERMARK_BYTES, subject: "a watermark" })
  return { session, channel: await readWatermarkChannel(session), file, image, timing }
}
