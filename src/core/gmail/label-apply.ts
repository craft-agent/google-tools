import { fetchInBatches } from "./fetch-batches"
import type { GmailLabelResult } from "./label-args"
import type { LabelPlan } from "./label-plan"
import { mailRoutes } from "./mail-items"
import { GMAIL_ROUTES } from "./routes"

/** The most ids one `messages.batchModify` takes. */
const BATCH_MODIFY_LIMIT = 1000

/**
 * Makes the planned change: first the `untrash` of each message or thread
 * (one request each), then the label change, so mail that comes back into the
 * Inbox can be archived by the same call. Messages change `BATCH_MODIFY_LIMIT`
 * at a time, threads one request each; a failure stops the call, and since the
 * change is idempotent the same call can be repeated.
 */
export async function applyLabelChange(plan: LabelPlan): Promise<GmailLabelResult> {
  const { client, selection, adds, removes, untrash } = plan
  const { kind, ids } = selection
  const { untrash: untrashRoute, param } = mailRoutes(kind)

  if (untrash) await fetchInBatches(ids, (id) => client.request(untrashRoute, { params: { [param]: id } }))

  if (adds.length > 0 || removes.length > 0) {
    const change = { addLabelIds: adds.map(({ id }) => id), removeLabelIds: removes.map(({ id }) => id) }
    if (kind === "threads") {
      await fetchInBatches(ids, (id) =>
        client.request(GMAIL_ROUTES.threadModify, { params: { thread_id: id }, body: change }),
      )
    } else {
      for (let start = 0; start < ids.length; start += BATCH_MODIFY_LIMIT) {
        await client.request(GMAIL_ROUTES.messagesBatchModify, {
          body: { ids: ids.slice(start, start + BATCH_MODIFY_LIMIT), ...change },
        })
      }
    }
  }
  return {
    changed: ids.length,
    adds: adds.map(({ name }) => name),
    removes: removes.map(({ name }) => name),
    untrashed: untrash ? ids.length : 0,
  }
}
