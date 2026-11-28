import type { CallDescription } from "../tool"
import type { ChannelEditPlan } from "./channel-edit-plan"
import { channelPin } from "./channel-state"
import { newValuesText } from "./video-edit-describe"
import { YOUTUBE_WORDS } from "./words"

/**
 * What the prompt shows of a channel edit: the headline with the channel's
 * name as Google has it, the fields that change, and a line for each new value
 * with the description last. The pin holds the branding properties the edit
 * read, so a channel changed after the prompt is `stale`.
 */
export function describeChannelEdit({ before, changes }: ChannelEditPlan): CallDescription {
  return {
    headline: { text: YOUTUBE_WORDS.channelEdit, values: { title: before.title } },
    facts: [{ label: YOUTUBE_WORDS.fields, value: changes.map(({ field }) => field).join(", ") }],
    text: newValuesText(changes),
    pins: { channel: channelPin(before) },
  }
}
