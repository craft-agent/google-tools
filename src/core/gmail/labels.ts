import { z } from "zod"
import type { GoogleClient } from "../google/client"
import { parseReply } from "../sheets/reply"
import { GMAIL_ROUTES } from "./routes"
import type { LabelsResult } from "./schemas"

const SYSTEM_LABEL = "system"

const labelsReply = z.object({
  labels: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        type: z.string().optional(),
        messagesTotal: z.number().int().optional(),
        messagesUnread: z.number().int().optional(),
      }),
    )
    .optional(),
})

/** The mailbox's labels, system and user, with their message counts where Google gives them. */
export async function readLabels(client: GoogleClient): Promise<LabelsResult> {
  const reply = parseReply(labelsReply, await client.request(GMAIL_ROUTES.labels), "the label list")
  return {
    labels: (reply.labels ?? []).map((label) => ({
      label_id: label.id,
      name: label.name ?? label.id,
      type: label.type === SYSTEM_LABEL ? SYSTEM_LABEL : "user",
      ...(label.messagesTotal !== undefined && { messages_total: label.messagesTotal }),
      ...(label.messagesUnread !== undefined && { messages_unread: label.messagesUnread }),
    })),
  }
}
