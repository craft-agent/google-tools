import type { CallDescription, CallFact } from "../tool"
import type { CurrentDraft, DraftDeletePlan, DraftEditPlan } from "./draft-plan"
import { DRAFT_PIN, describeMail } from "./send-facts"
import type { MailPlan } from "./send-plan"
import { GMAIL_WORDS } from "./words"

/** The `Replaces` fact: the subject and the recipient count of the draft as Google holds it now. */
function replacesFact({ subject, recipientCount }: CurrentDraft): CallFact {
  return {
    label: GMAIL_WORDS.replaces,
    value:
      subject === ""
        ? { text: GMAIL_WORDS.replacesNoSubject, values: { count: recipientCount } }
        : { text: GMAIL_WORDS.replacesValue, values: { subject, count: recipientCount } },
  }
}

/** What the prompt shows of a new draft: its subject in the headline, then what a mail shows. */
export function describeDraftCreate(plan: MailPlan, body: string): CallDescription {
  return describeMail(plan, body, { headline: { text: GMAIL_WORDS.draftCreate, values: { subject: plan.subject } } })
}

/** What the prompt shows of a draft's replacement: the draft it replaces first, pinned by its message id, then what a mail shows. */
export function describeDraftEdit(plan: DraftEditPlan, body: string): CallDescription {
  return describeMail(plan, body, {
    headline: { text: GMAIL_WORDS.draftEdit, values: { subject: plan.subject } },
    before: [replacesFact(plan.current)],
    pins: { [DRAFT_PIN]: plan.current.messageId },
  })
}

/** What the prompt shows of a draft that is deleted: its subject in the headline, its recipients and its date as Google reports them, and its message id as a pin. */
export function describeDraftDelete({ current }: DraftDeletePlan): CallDescription {
  const facts = [
    { label: GMAIL_WORDS.to, value: current.to },
    { label: GMAIL_WORDS.date, value: current.date },
  ]
  return {
    headline:
      current.subject === ""
        ? { text: GMAIL_WORDS.draftDeleteNoSubject }
        : { text: GMAIL_WORDS.draftDelete, values: { subject: current.subject } },
    facts: facts.flatMap(({ label, value }): CallFact[] => (value ? [{ label, value }] : [])),
    pins: { [DRAFT_PIN]: current.messageId },
  }
}
