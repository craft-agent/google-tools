import { z } from "zod"
import { ToolError, isToolError } from "../errors"
import type { GoogleClient } from "../google/client"
import { parseReply } from "../sheets/reply"
import { fetchInBatches } from "./fetch-batches"
import { messageView } from "./message-view"
import { fullMessageSchema, headerOf, type FullMessage } from "./payload"
import { GMAIL_ROUTES } from "./routes"
import {
  DEFAULT_SEARCH_LIMIT,
  MAX_BODY_CHARACTERS,
  type DraftResult,
  type DraftsResult,
  type DraftSummary,
  type GmailReadArgs,
} from "./schemas"

/** The headers a draft's metadata is asked for, which a list and the prompts of the draft tools show. */
export const DRAFT_HEADERS = ["To", "Cc", "Bcc", "Subject", "Date"]

const listReply = z.object({
  drafts: z.array(z.object({ id: z.string() })).optional(),
  nextPageToken: z.string().optional(),
})

const draftReply = z.object({ id: z.string(), message: fullMessageSchema.optional() })

/** A draft as Google gives it: its id and its message. */
export type Draft = { id: string; message: FullMessage }

/** How much of a draft is asked for: its headers alone, or the message with every part. */
export type DraftFormat = "metadata" | "full"

/** The draft `draftId`, in `format`; a draft Google gives with no message is `upstream_error`. */
export async function fetchDraft(client: GoogleClient, draftId: string, format: DraftFormat): Promise<Draft> {
  const draft = parseReply(
    draftReply,
    await client.request(GMAIL_ROUTES.draft, {
      params: { draft_id: draftId },
      query: format === "metadata" ? { format, metadataHeaders: DRAFT_HEADERS } : { format },
    }),
    "a draft",
  )
  if (draft.message === undefined) throw new ToolError("upstream_error", "Google gave a draft with no message.")
  return { id: draft.id, message: draft.message }
}

/** The list view of one draft, or `undefined` when it was deleted between the list and the read. */
async function draftSummary(client: GoogleClient, id: string): Promise<DraftSummary | undefined> {
  let draft: Draft
  try {
    draft = await fetchDraft(client, id, "metadata")
  } catch (error) {
    if (isToolError(error) && error.code === "not_found") return undefined
    throw error
  }
  const { message } = draft
  return {
    draft_id: draft.id,
    message_id: message.id,
    thread_id: message.threadId ?? "",
    to: headerOf(message.payload, "To"),
    cc: headerOf(message.payload, "Cc"),
    bcc: headerOf(message.payload, "Bcc"),
    subject: headerOf(message.payload, "Subject"),
    date: headerOf(message.payload, "Date"),
    snippet: message.snippet ?? "",
  }
}

/**
 * The account's drafts that match `query`, with the headers a person scans and
 * a snippet; never the body. The drafts are read a few at a time, and one that
 * is gone by the time it is read is left out.
 */
export async function listDrafts(
  client: GoogleClient,
  args: Pick<GmailReadArgs, "query" | "limit" | "page_token">,
): Promise<DraftsResult> {
  const listed = parseReply(
    listReply,
    await client.request(GMAIL_ROUTES.drafts, {
      query: { q: args.query, maxResults: args.limit ?? DEFAULT_SEARCH_LIMIT, pageToken: args.page_token },
    }),
    "the draft list",
  )
  const found = await fetchInBatches(
    (listed.drafts ?? []).map((draft) => draft.id),
    (id) => draftSummary(client, id),
  )
  return { drafts: found.filter((draft) => draft !== undefined), next_page_token: listed.nextPageToken ?? null }
}

/** One draft: its message as `message` gives it (the body clipped to `MAX_BODY_CHARACTERS`), and the draft's id. */
export async function readDraft(client: GoogleClient, draftId: string): Promise<DraftResult> {
  const { id, message } = await fetchDraft(client, draftId, "full")
  return { ...messageView(message, MAX_BODY_CHARACTERS).view, draft_id: id }
}
