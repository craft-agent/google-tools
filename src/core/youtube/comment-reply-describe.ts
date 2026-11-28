import type { CallDescription } from "../tool"
import { UNKNOWN_AUTHOR, digestOf } from "./comment-facts"
import type { ReplyPlan } from "./comment-reply-plan"
import { privacyFact } from "./video-facts"
import { statePin } from "./video-state"
import { YOUTUBE_WORDS } from "./words"

/**
 * What the prompt shows of a reply: the headline with the author of the
 * thread's top-level comment and the video's title as Google has them, who can
 * watch the video (a reply on a public video is seen at once), the comment it
 * answers and the reply's text. The pins hold the video's writable properties
 * and the thread's comment, so a video or a comment changed after the prompt
 * is `stale`.
 */
export function describeReply({ thread, state, author, comment, canReply, text }: ReplyPlan): CallDescription {
  return {
    headline: {
      text: YOUTUBE_WORDS.replyTo,
      values: { author: author ?? UNKNOWN_AUTHOR, title: state.snippet.title },
    },
    facts: [privacyFact(YOUTUBE_WORDS.privacy, state.status), { label: YOUTUBE_WORDS.comment, value: comment }],
    text: { label: YOUTUBE_WORDS.reply, body: text },
    pins: { video: statePin(state), thread: digestOf({ id: thread, text: comment, canReply }) },
  }
}
