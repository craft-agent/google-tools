import { z } from "zod"
import type { GoogleClient } from "../google/client"
import { parseReply } from "../sheets/reply"
import { messageView } from "./message-view"
import { fullMessageSchema } from "./payload"
import { GMAIL_ROUTES } from "./routes"
import { MAX_BODY_CHARACTERS, MAX_THREAD_BODY_CHARACTERS, type MessageView, type ThreadResult } from "./schemas"

const threadReply = z.object({
  id: z.string(),
  messages: z.array(fullMessageSchema).optional(),
})

/**
 * A thread with every message in it, oldest first, as `readMessage` shows
 * one. A body is clipped to `MAX_BODY_CHARACTERS` and the bodies together to
 * `MAX_THREAD_BODY_CHARACTERS`: once they are spent the later bodies are
 * empty and say `body_truncated`.
 */
export async function readThread(client: GoogleClient, id: string): Promise<ThreadResult> {
  const reply = parseReply(
    threadReply,
    await client.request(GMAIL_ROUTES.thread, { params: { thread_id: id }, query: { format: "full" } }),
    "a thread",
  )
  let remaining = MAX_THREAD_BODY_CHARACTERS
  const messages: MessageView[] = []
  for (const message of reply.messages ?? []) {
    const { view, length } = messageView(message, Math.min(MAX_BODY_CHARACTERS, remaining))
    remaining -= length
    messages.push(view)
  }
  return { thread_id: reply.id, messages }
}
