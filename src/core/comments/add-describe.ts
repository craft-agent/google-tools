import type { CallDescription, CallFact, CallHeadline } from "../tool"
import type { CommentPlan, Emailed, RepliedThread } from "./add-plan"
import { authoredStart, fileName } from "./thread-facts"
import { COMMENTS_WORDS } from "./words"

/** The pins that hold what the prompt shows of the thread replied to and of the tab commented on. */
const THREAD_TEXT_PIN = "thread_text"
const TAB_TITLE_PIN = "tab_title"

/** The `Emailed` fact: every address Google emails with its role, first in the prompt since mail cannot be taken back. */
function emailedFact(emailed: readonly Emailed[]): CallFact {
  return {
    label: COMMENTS_WORDS.emailed,
    value:
      emailed.length === 0
        ? { text: COMMENTS_WORDS.nobody }
        : emailed.map(({ address, role }) => `${address} (${role})`).join(", "),
  }
}

/** The `Replying to` fact: the thread's author and the start of its text, on one line. */
function repliedFact({ author, text }: RepliedThread): CallFact {
  return { label: COMMENTS_WORDS.replyingTo, value: authoredStart(author, text) }
}

function headlineOf({ file, cell, thread }: CommentPlan): CallHeadline {
  const name = fileName(file)
  if (cell !== null) return { text: COMMENTS_WORDS.commentAt, values: { file: name, cell: cell.at } }
  return { text: thread === null ? COMMENTS_WORDS.comment : COMMENTS_WORDS.reply, values: { file: name } }
}

/** A reply pins the thread's first text and a new spreadsheet comment its tab's title; a new comment on another file pins nothing. */
function pinsOf({ thread, cell }: CommentPlan): Record<string, string> | undefined {
  if (thread !== null) return { [THREAD_TEXT_PIN]: thread.text }
  return cell === null ? undefined : { [TAB_TITLE_PIN]: cell.tabTitle }
}

/**
 * What the prompt shows of a comment: the headline, who Google emails first,
 * the thread replied to and whether it is resolved, and the comment's words
 * as they will be written.
 */
export function describeComment(plan: CommentPlan): CallDescription {
  const { thread } = plan
  const facts = [emailedFact(plan.emailed)]
  if (thread !== null) facts.push(repliedFact(thread))
  if (thread?.resolved) facts.push({ label: COMMENTS_WORDS.status, value: { text: COMMENTS_WORDS.resolved } })
  const pins = pinsOf(plan)
  return {
    headline: headlineOf(plan),
    facts,
    text: { label: COMMENTS_WORDS.text, body: plan.text },
    ...(pins && { pins }),
  }
}
