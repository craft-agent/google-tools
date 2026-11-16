import type { CallDescription, CallFact, CallHeadline } from "../tool"
import type { LabelPlan } from "./label-plan"
import { mailText, readItems } from "./mail-items"
import { GMAIL_WORDS } from "./words"

/** The most mail a label prompt lists; the rest is counted. */
export const MAX_LISTED_MAIL = 50

/** The headline: how many messages or threads change, in the form for one or for many. */
function labelHeadline({ kind, ids }: LabelPlan["selection"]): CallHeadline {
  if (ids.length === 1) return { text: kind === "messages" ? GMAIL_WORDS.labelMessage : GMAIL_WORDS.labelThread }
  return {
    text: kind === "messages" ? GMAIL_WORDS.labelMessages : GMAIL_WORDS.labelThreads,
    values: { count: String(ids.length) },
  }
}

/** The facts in the order they decide: the labels added and removed, whether the mail leaves the trash, and how much mail changes. */
function labelFacts({ adds, removes, untrash, selection }: LabelPlan): CallFact[] {
  return [
    ...(adds.length > 0 ? [{ label: GMAIL_WORDS.adds, value: adds.map(({ name }) => name).join(", ") }] : []),
    ...(removes.length > 0 ? [{ label: GMAIL_WORDS.removes, value: removes.map(({ name }) => name).join(", ") }] : []),
    ...(untrash ? [{ label: GMAIL_WORDS.untrash, value: { text: GMAIL_WORDS.yes } }] : []),
    {
      label: selection.kind === "messages" ? GMAIL_WORDS.messages : GMAIL_WORDS.threads,
      value: String(selection.ids.length),
    },
  ]
}

/** What the prompt shows of a label change: the headline, the facts, and a line for each of the first `MAX_LISTED_MAIL` messages or threads as Google holds them. Labels are idempotent, so nothing is pinned. */
export async function describeLabel(plan: LabelPlan): Promise<CallDescription> {
  const { client, selection } = plan
  const items = await readItems(client, selection.kind, selection.ids.slice(0, MAX_LISTED_MAIL))
  return {
    headline: labelHeadline(selection),
    facts: labelFacts(plan),
    text: mailText(items, selection.ids.length),
  }
}
