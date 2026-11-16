import { createHash } from "node:crypto"
import { singleLine } from "../gmail/send-plan"
import type { CallDescription, CallFact, CallHeadline, CallValue } from "../tool"
import { itemKind, type DriveItem } from "./item"
import { TRASH_RETENTION_DAYS } from "./trash-args"
import { isSettled, type TrashDirection } from "./trash-plan"
import { DRIVE_WORDS } from "./words"

/** The pin that holds every item's id and version, so items that changed after the prompt are `stale`. */
const ITEMS_PIN = "items"

/** The headline templates of a call, for one item and for many, and what a line of the text says of an item left as it is. */
const DIRECTIONS = {
  trash: { one: DRIVE_WORDS.trashOne, many: DRIVE_WORDS.trashMany, settled: "already in the trash" },
  restore: { one: DRIVE_WORDS.restoreOne, many: DRIVE_WORDS.restoreMany, settled: "not in the trash" },
} as const satisfies Record<TrashDirection, { one: string; many: string; settled: string }>

/** Whether other people can reach the item: it is in a shared drive, or Drive says it is shared. */
function isSharedItem(item: DriveItem): boolean {
  return item.shared === true || item.driveId !== undefined
}

/** A count, in the form for one or for many. */
function countValue(count: number): CallValue {
  return { text: count === 1 ? DRIVE_WORDS.countOne : DRIVE_WORDS.countMany, values: { count } }
}

/** The headline: the item's name when there is one item, else how many items. */
function headline(direction: TrashDirection, items: readonly DriveItem[]): CallHeadline {
  const words = DIRECTIONS[direction]
  const [only, ...others] = items
  if (only !== undefined && others.length === 0) return { text: words.one, values: { name: only.name ?? "" } }
  return { text: words.many, values: { count: String(items.length) } }
}

/** The line of one item: its name, a dash, its kind, whether others can reach it and whether the call leaves it as it is. */
function itemLine(item: DriveItem, direction: TrashDirection): string {
  const notes = [
    itemKind(item),
    ...(isSharedItem(item) ? ["shared"] : []),
    ...(isSettled(item, direction) ? [DIRECTIONS[direction].settled] : []),
  ]
  return `${singleLine(item.name ?? "")} — ${notes.join(", ")}`
}

/** One digest of every item's id and version: a prompt keeps few pins, and a call may name a hundred items. */
function itemsDigest(items: readonly DriveItem[]): string {
  return createHash("sha256")
    .update(items.map(({ id, version }) => `${id}:${version ?? ""}`).join("\n"))
    .digest("hex")
}

/**
 * What the prompt shows of a move to or out of the trash: the headline, how
 * many items and, for the trash, when Drive deletes them and how many of them
 * others can reach; a line for every item as Google holds it now; and the
 * items' versions as a pin.
 */
export function describeTrash(
  { direction }: { direction: TrashDirection },
  items: readonly DriveItem[],
): CallDescription {
  const shared = items.filter(isSharedItem).length
  const facts: CallFact[] = [{ label: DRIVE_WORDS.count, value: countValue(items.length) }]
  if (direction === "trash") {
    facts.push({
      label: DRIVE_WORDS.deletedAfter,
      value: { text: DRIVE_WORDS.days, values: { days: TRASH_RETENTION_DAYS } },
    })
    if (shared > 0) facts.push({ label: DRIVE_WORDS.shared, value: countValue(shared) })
  }
  return {
    headline: headline(direction, items),
    facts,
    text: { label: DRIVE_WORDS.items, body: items.map((item) => itemLine(item, direction)).join("\n") },
    pins: { [ITEMS_PIN]: itemsDigest(items) },
  }
}
