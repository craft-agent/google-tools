import { phrase } from "../run/facts"
import type { CallDescription, CallFact } from "../tool"
import { commentsText, digestOf, videosFact } from "./comment-facts"
import type { ModerationPlan } from "./comment-moderation-plan"
import { YOUTUBE_WORDS } from "./words"

/** The headline of each moderation, for one comment and for many. */
const HEADLINES = {
  published: { one: YOUTUBE_WORDS.publishOne, many: YOUTUBE_WORDS.publishMany },
  heldForReview: { one: YOUTUBE_WORDS.holdOne, many: YOUTUBE_WORDS.holdMany },
  rejected: { one: YOUTUBE_WORDS.rejectOne, many: YOUTUBE_WORDS.rejectMany },
  rejectedAndBanned: { one: YOUTUBE_WORDS.rejectBanOne, many: YOUTUBE_WORDS.rejectBanMany },
} as const

/**
 * What the prompt shows of a moderation: the headline with how many comments,
 * `lead` facts, who can watch the videos the comments are on (the privacy of
 * their video when it is one, else how many videos), and a line for each
 * comment, its author and its text as Google gives them. The pins hold each
 * comment's id, text and moderation status and each video's id and privacy, so
 * a comment or a video changed after the prompt is `stale`.
 */
function describeModeration(
  { comments, videos }: ModerationPlan,
  headline: (typeof HEADLINES)[keyof typeof HEADLINES],
  lead: CallFact[] = [],
): CallDescription {
  return {
    headline: {
      text: comments.length === 1 ? headline.one : headline.many,
      values: { count: String(comments.length) },
    },
    facts: [...lead, videosFact(videos)],
    text: commentsText(comments),
    pins: {
      comments: digestOf(comments.map(({ id, text, moderation }) => ({ id, text, moderation }))),
      videos: digestOf(videos.map(({ id, status }) => ({ id, status }))),
    },
  }
}

/** What the prompt shows of a publication or a hold of comments. */
export function describePublishOrHold(plan: ModerationPlan): CallDescription {
  return describeModeration(plan, plan.status === "published" ? HEADLINES.published : HEADLINES.heldForReview)
}

/** What the prompt shows of a rejection: that it cannot be undone and whether the authors are banned, then as for any moderation. */
export function describeRejection(plan: ModerationPlan): CallDescription {
  return describeModeration(plan, plan.ban ? HEADLINES.rejectedAndBanned : HEADLINES.rejected, [
    { label: YOUTUBE_WORDS.undo, value: phrase(YOUTUBE_WORDS.undoNone) },
    { label: YOUTUBE_WORDS.ban, value: phrase(plan.ban ? YOUTUBE_WORDS.banYes : YOUTUBE_WORDS.no) },
  ])
}
