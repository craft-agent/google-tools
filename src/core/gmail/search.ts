import { z } from "zod"
import { isToolError } from "../errors"
import type { GoogleClient } from "../google/client"
import { parseReply } from "../sheets/reply"
import { headerOf, partSchema } from "./payload"
import { GMAIL_ROUTES } from "./routes"
import { DEFAULT_SEARCH_LIMIT, type GmailReadArgs, type SearchedMessage, type SearchResult } from "./schemas"

/** The headers a search result shows, which is all the metadata format is asked for. */
const SEARCH_HEADERS = ["From", "To", "Cc", "Subject", "Date"]

/** How many messages are fetched at once. */
const FETCH_CONCURRENCY = 5

const listReply = z.object({
  messages: z.array(z.object({ id: z.string() })).optional(),
  nextPageToken: z.string().optional(),
  resultSizeEstimate: z.number().int().optional(),
})

const metadataReply = z.object({
  id: z.string(),
  threadId: z.string().optional(),
  snippet: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
  payload: partSchema.optional(),
})

/** The search view of one message, or `undefined` when it was deleted between the list and the read. */
async function searchedMessage(client: GoogleClient, id: string): Promise<SearchedMessage | undefined> {
  let reply: unknown
  try {
    reply = await client.request(GMAIL_ROUTES.message, {
      params: { message_id: id },
      query: { format: "metadata", metadataHeaders: SEARCH_HEADERS },
    })
  } catch (error) {
    if (isToolError(error) && error.code === "not_found") return undefined
    throw error
  }
  const message = parseReply(metadataReply, reply, "a message")
  return {
    message_id: message.id,
    thread_id: message.threadId ?? "",
    from: headerOf(message.payload, "From"),
    to: headerOf(message.payload, "To"),
    cc: headerOf(message.payload, "Cc"),
    subject: headerOf(message.payload, "Subject"),
    date: headerOf(message.payload, "Date"),
    snippet: message.snippet ?? "",
    labels: message.labelIds ?? [],
  }
}

/**
 * The messages that match `query`, newest first, with the headers a person
 * scans and a snippet; never the body. The messages are read a few at a time,
 * and one that is gone by the time it is read is left out.
 */
export async function searchMessages(
  client: GoogleClient,
  args: Pick<GmailReadArgs, "query" | "limit" | "page_token" | "include_spam_trash">,
): Promise<SearchResult> {
  const listed = parseReply(
    listReply,
    await client.request(GMAIL_ROUTES.messages, {
      query: {
        q: args.query,
        maxResults: args.limit ?? DEFAULT_SEARCH_LIMIT,
        pageToken: args.page_token,
        includeSpamTrash: args.include_spam_trash,
      },
    }),
    "the message list",
  )
  const ids = (listed.messages ?? []).map((message) => message.id)
  const found: (SearchedMessage | undefined)[] = []
  for (let start = 0; start < ids.length; start += FETCH_CONCURRENCY) {
    found.push(
      ...(await Promise.all(ids.slice(start, start + FETCH_CONCURRENCY).map((id) => searchedMessage(client, id)))),
    )
  }
  return {
    messages: found.filter((message) => message !== undefined),
    next_page_token: listed.nextPageToken ?? null,
    result_size_estimate: listed.resultSizeEstimate ?? 0,
  }
}
