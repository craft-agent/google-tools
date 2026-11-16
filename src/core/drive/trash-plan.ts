import { fetchInBatches } from "../gmail/fetch-batches"
import type { GoogleClient } from "../google/client"
import { StepErrors, type ToolContext } from "../tool"
import { SUPPORTS_ALL_DRIVES } from "./file-view"
import { driveId } from "./ids"
import { readItem, type DriveItem } from "./item"
import { DRIVE_ROUTES } from "./routes"
import { NOTHING_CHANGED, driveWriteSession, refusedWrite } from "./write-session"

/** The fields of a changed item the answer carries; the answer is not used, so only the id. */
const CHANGED_FIELDS = "id"

/** What is said of an item of a call whose change failed after earlier ones were made. */
const ITEM_UNCHANGED = "this item was not changed"

/** Which way a call moves items: into the trash, or out of it. */
export type TrashDirection = "trash" | "restore"

/** A call that moves items planned: the items it names, each once in the order given. */
export type TrashPlan = {
  client: GoogleClient
  label: string
  ids: string[]
  direction: TrashDirection
}

/** What a call did: the ids it changed, the ids it left as they were and the failure that stopped it, if any. */
export type TrashChange = { ids: string[]; skipped: string[]; errors?: Record<string, string> }

/** Checks the arguments (the ids, each once), then the label's scopes, before anything is read or written. */
export async function planTrash(
  args: { account?: string; file_ids: readonly string[] },
  direction: TrashDirection,
  ctx: ToolContext,
): Promise<TrashPlan> {
  const ids = [...new Set(args.file_ids.map((id) => driveId(id, "file id")))]
  const { client, label } = await driveWriteSession(ctx, args.account, DRIVE_ROUTES.update)
  return { client, label, ids, direction }
}

/** The items the plan names, read five at a time, in the order of the ids; one that is gone is `not_found`. */
export function readItems({ client, ids }: TrashPlan): Promise<DriveItem[]> {
  return fetchInBatches(ids, (id) => readItem(client, id))
}

/** Whether the item is in the state the call asks for already: in the trash for a trash, out of it for a restore. */
export function isSettled(item: Pick<DriveItem, "trashed">, direction: TrashDirection): boolean {
  return (item.trashed === true) === (direction === "trash")
}

/**
 * Moves the items that are not in the state asked for, one request each and in
 * order; the others are `skipped`. A failure of the first request throws,
 * since nothing was changed; a failure of a later one stops the call and is
 * listed under `errors` beside what was changed, so what the call did is never
 * lost.
 */
export async function changeAll(plan: TrashPlan, items: readonly DriveItem[]): Promise<TrashChange> {
  const { client, direction } = plan
  const settled = items.filter((item) => isSettled(item, direction)).map(({ id }) => id)
  const [first, ...rest] = items.filter((item) => !isSettled(item, direction)).map(({ id }) => id)
  const changed: string[] = []
  const steps = new StepErrors()
  const change = async (id: string, unchanged: string) => {
    await refusedWrite(
      () =>
        client.request(DRIVE_ROUTES.update, {
          params: { file_id: id },
          query: { ...SUPPORTS_ALL_DRIVES, fields: CHANGED_FIELDS },
          body: { trashed: direction === "trash" },
        }),
      unchanged,
    )
    return true
  }

  if (first !== undefined) {
    await change(first, NOTHING_CHANGED)
    changed.push(first)
    for (const id of rest) {
      if (!(await steps.record(id, () => change(id, ITEM_UNCHANGED)))) break
      changed.push(id)
    }
  }
  return { ids: changed, skipped: settled, ...(steps.any && { errors: steps.errors }) }
}
