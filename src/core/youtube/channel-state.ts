import { createHash } from "node:crypto"
import type { z } from "zod"
import { ToolError } from "../errors"
import { canonicalJson } from "../pin"
import type { BrandingSettings, myChannelReply } from "./my-channel-view"

/** The parts of the label's channel an edit reads: `channels.update` takes the branding settings whole, and the snippet holds the title. */
export const CHANNEL_STATE_PARTS = "brandingSettings,snippet"

/** The label's channel as `channels.list` and `channels.update` give it with the parts above. */
export type ChannelStateReply = z.output<typeof myChannelReply>

/** A channel as an edit works with it: the branding settings an update sends back whole, as Google gave them, and the title the prompt shows. */
export type ChannelState = {
  id: string
  /** The channel's name, which Google refuses to have changed. */
  title: string
  branding: BrandingSettings
}

/** The channel `reply` holds as a state; one without a title is not the shape the edit relies on, `upstream_error`. */
export function channelState(reply: ChannelStateReply): ChannelState {
  const { snippet, brandingSettings } = reply
  const title = snippet?.title ?? brandingSettings?.channel?.title
  if (title === undefined) {
    throw new ToolError("upstream_error", "Google's reply to the channel list was not in the expected shape.")
  }
  return {
    id: reply.id,
    title,
    branding: brandingSettings ?? {},
  }
}

/** `state` with what Google's update `reply` reports laid over it: a reply that leaves the branding settings out, or is not the channel's shape, changes nothing. */
export function withChannelReply(state: ChannelState, reply: ChannelStateReply | undefined): ChannelState {
  return { ...state, branding: reply?.brandingSettings ?? state.branding }
}

/**
 * The digest of the properties an edit sends back and changes, which the
 * prompt pins: a channel whose `brandingSettings.channel` changed after the
 * prompt gives another one, so the call is `stale`.
 */
export function channelPin({ branding }: ChannelState): string {
  return createHash("sha256")
    .update(canonicalJson({ channel: branding.channel ?? null }))
    .digest("hex")
}
