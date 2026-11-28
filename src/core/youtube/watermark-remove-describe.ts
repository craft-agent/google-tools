import type { CallDescription } from "../tool"
import type { WatermarkRemovePlan } from "./watermark-remove-plan"
import { YOUTUBE_WORDS } from "./words"

/**
 * What the prompt shows of a watermark removal: the headline with the
 * channel's name as Google has it. Google does not say whether the channel has
 * a watermark, so there is nothing more to show. The channel is a pin, so a
 * channel changed after the prompt is `stale`.
 */
export function describeWatermarkRemove({ channel }: WatermarkRemovePlan): CallDescription {
  return {
    headline: { text: YOUTUBE_WORDS.watermarkRemove, values: { channel: channel.title } },
    facts: [],
    pins: { channel: channel.pin },
  }
}
