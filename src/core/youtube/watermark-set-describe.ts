import { sizeFact } from "../facts"
import type { CallDescription, CallValue } from "../tool"
import type { WatermarkSetPlan, WatermarkTiming } from "./watermark-set-plan"
import { YOUTUBE_WORDS } from "./words"

/** When the watermark is shown, as a value template with the seconds as values: the whole video, or from a moment, to the end or for a time. */
function shownValue({ from, offsetSeconds: offset, durationSeconds: duration }: WatermarkTiming): CallValue {
  if (duration === null) {
    if (from === "end") return { text: YOUTUBE_WORDS.shownFromEnd, values: { offset } }
    return offset === 0
      ? { text: YOUTUBE_WORDS.shownWhole }
      : { text: YOUTUBE_WORDS.shownFromStart, values: { offset } }
  }
  if (from === "end") return { text: YOUTUBE_WORDS.shownFromEndFor, values: { offset, duration } }
  return offset === 0
    ? { text: YOUTUBE_WORDS.shownFirst, values: { duration } }
    : { text: YOUTUBE_WORDS.shownFromStartFor, values: { offset, duration } }
}

/**
 * What the prompt shows of a watermark change: the headline with the channel's
 * name as Google has it, when the watermark is shown on every video of the
 * channel, and the image's real path, size and type. The image's SHA-256 and
 * the channel are pins, so a file or a channel changed after the prompt is
 * `stale`. Google does not say whether the channel has a watermark, so the
 * prompt cannot show the one it replaces.
 */
export function describeWatermarkSet({ channel, file, image, timing }: WatermarkSetPlan): CallDescription {
  return {
    headline: { text: YOUTUBE_WORDS.watermarkSet, values: { channel: channel.title } },
    facts: [
      { label: YOUTUBE_WORDS.shown, value: shownValue(timing) },
      { label: YOUTUBE_WORDS.from, value: file.path },
      sizeFact(file.size),
      { label: YOUTUBE_WORDS.type, value: image.name },
    ],
    pins: { content: file.sha256, channel: channel.pin },
  }
}
