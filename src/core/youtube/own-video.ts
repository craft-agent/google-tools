import { ToolError } from "../errors"
import { shown } from "../run/ids"
import { parseReply } from "../sheets/reply"
import { youtubeError } from "./errors"
import { ownChannel, type OwnSession } from "./own-calls"
import { YOUTUBE_ROUTES } from "./routes"
import { VIDEO_STATE_PARTS, videoState, videosStateList, type VideoState } from "./video-state"

/**
 * The video the label's own channel holds, as the writes plan with it: the
 * channel's id and the video's writable parts. A video Google does not return
 * is `not_found`, and one of another channel is `forbidden`, nothing sent, so
 * a prompt never shows another channel's video as its subject. Google's
 * failures come out as `youtubeError` makes them.
 */
export async function ownVideo(session: OwnSession, video: string): Promise<{ channelId: string; state: VideoState }> {
  const { channel, found } = await readFromGoogle(session, video)
  if (found === undefined) {
    throw new ToolError("not_found", `Video ${video} was not found, or the account cannot see it.`)
  }
  if (found.snippet?.channelId !== channel.id) {
    throw new ToolError(
      "forbidden",
      `Video ${shown(found.snippet?.title ?? "")} (${video}) belongs to another channel; only the channel's own videos can be changed. Nothing was sent.`,
    )
  }
  return { channelId: channel.id, state: videoState(found) }
}

/** The label's channel, then the video `id` as `videos.list` gives it, if it does. */
async function readFromGoogle(session: OwnSession, id: string) {
  try {
    const channel = await ownChannel(session, "id")
    const reply = await session.client.request(YOUTUBE_ROUTES.videos, {
      query: { part: VIDEO_STATE_PARTS, id },
    })
    const found = parseReply(videosStateList, reply, "the video list").items?.find((item) => item.id === id)
    return { channel, found }
  } catch (error) {
    throw youtubeError(error)
  }
}
