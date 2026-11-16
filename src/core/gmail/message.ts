import type { GoogleClient } from "../google/client"
import { parseReply } from "../sheets/reply"
import { messageView } from "./message-view"
import { fullMessageSchema, type FullMessage } from "./payload"
import { GMAIL_ROUTES } from "./routes"
import { MAX_BODY_CHARACTERS, type MessageView } from "./schemas"

/** The message `id` with every part, as Gmail gives it. */
export async function fetchFullMessage(client: GoogleClient, id: string): Promise<FullMessage> {
  return parseReply(
    fullMessageSchema,
    await client.request(GMAIL_ROUTES.message, { params: { message_id: id }, query: { format: "full" } }),
    "a message",
  )
}

/** One message with its headers, its body as text (clipped to `MAX_BODY_CHARACTERS`) and the list of its attachments. */
export async function readMessage(client: GoogleClient, id: string): Promise<MessageView> {
  return messageView(await fetchFullMessage(client, id), MAX_BODY_CHARACTERS).view
}
