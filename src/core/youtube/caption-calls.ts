import { createHash } from "node:crypto"
import { UPLOAD_TIMEOUT_MS } from "../files/resumable-send"
import { relatedUpload } from "../gmail/upload-body"
import type { Route } from "../google/routes"
import { canonicalJson } from "../pin"
import { parseReply } from "../sheets/reply"
import { CAPTION_MEDIA_TYPE, type CaptionFile } from "./caption-file"
import { captionReply, captionView, type CaptionView } from "./caption-view"
import { youtubeError } from "./errors"
import { readCaptions, type OwnSession } from "./own-calls"

/** The query of a multipart caption upload. */
const MULTIPART_QUERY = { uploadType: "multipart", part: "snippet" }

/** What a caption write sends: the route, the JSON metadata and, when a file goes with it, that file. */
export type CaptionRequest = {
  route: Route
  metadata: object
  file?: CaptionFile
}

/** The caption tracks of the video as Google lists them, its failures as `youtubeError` makes them. */
export async function trackList(session: OwnSession, video: string): Promise<CaptionView[]> {
  try {
    return (await readCaptions(session, video)).tracks
  } catch (error) {
    throw youtubeError(error)
  }
}

/** The digest of a track as it was read, which the prompt pins: a track changed after the prompt gives another one. */
export function trackPin(track: CaptionView): string {
  return createHash("sha256").update(canonicalJson(track)).digest("hex")
}

/**
 * Sends the request and returns the track as Google reports it: a call with a
 * file goes as a multipart upload of the metadata and the file's exact bytes,
 * one without as the metadata alone. Google's failures come out as
 * `youtubeError` makes them.
 */
export async function sendCaption(
  session: OwnSession,
  { route, metadata, file }: CaptionRequest,
): Promise<CaptionView> {
  let reply: unknown
  try {
    reply =
      file === undefined
        ? await session.client.request(route, { query: { part: "snippet" }, body: metadata })
        : await session.client.request(route, {
            query: MULTIPART_QUERY,
            content: relatedUpload(metadata, file.bytes, CAPTION_MEDIA_TYPE),
            timeoutMs: UPLOAD_TIMEOUT_MS,
          })
  } catch (error) {
    throw youtubeError(error)
  }
  return captionView(parseReply(captionReply, reply, "the caption track"))
}
