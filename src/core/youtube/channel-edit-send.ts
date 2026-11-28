import type { ChannelEditPlan } from "./channel-edit-plan"
import { withChannelReply, type ChannelState } from "./channel-state"
import { youtubeError } from "./errors"
import { myChannelReply } from "./my-channel-view"
import { YOUTUBE_ROUTES } from "./routes"

/**
 * Sends the planned branding settings, whole, in one request and returns the
 * channel as Google reports it. A reply that is not the channel's shape is no
 * failure, since the request went through: it reports nothing, so the planned
 * values stand.
 */
export async function sendChannelEdit(plan: ChannelEditPlan): Promise<ChannelState> {
  let reply: unknown
  try {
    reply = await plan.session.client.request(YOUTUBE_ROUTES.channelsUpdate, {
      query: { part: "brandingSettings" },
      body: { id: plan.after.id, brandingSettings: plan.after.branding },
    })
  } catch (error) {
    throw youtubeError(error)
  }
  const parsed = myChannelReply.safeParse(reply)
  return withChannelReply(plan.after, parsed.success ? parsed.data : undefined)
}
