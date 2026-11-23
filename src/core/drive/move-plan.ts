import { createHash } from "node:crypto"
import { ToolError } from "../errors"
import type { GoogleClient } from "../google/client"
import type { ToolContext } from "../tool"
import { folderName } from "./destination-facts"
import { readSharing } from "./file"
import { ROOT_FOLDER, driveId, folderId } from "./ids"
import { itemKind, readItem, type DriveItem } from "./item"
import type { DriveMoveArgs } from "./move-args"
import { DRIVE_ROUTES } from "./routes"
import { isShared } from "./sharing"
import { folderPin, readDestination, type Destination } from "./upload-destination"
import { driveWriteSession } from "./write-session"

/** The most levels of the destination's ancestors a folder move follows. */
const MAX_ANCESTOR_DEPTH = 100

/** A folder the item is in now, which the move takes it from: its id, the name the prompt shows and a digest of its sharing. */
export type ParentFolder = { id: string; name: string; pin: string }

/** A move planned: the item, where it goes and every folder it is in now, each one reachable by no one else. */
export type MovePlan = {
  client: GoogleClient
  label: string
  item: DriveItem
  destination: Destination
  parents: ParentFolder[]
}

/** The refusal of a move that would put a folder into itself or into a folder inside it. */
export function cyclicMove(): ToolError {
  return new ToolError("invalid_argument", "A folder cannot be moved into itself or into a folder inside it.")
}

/** Refuses a folder's destination below itself, following every parent up to My Drive or the depth bound. */
async function checkAncestors(client: GoogleClient, itemId: string, destination: Destination): Promise<void> {
  if (destination.name === null) return
  let ancestors = [destination.id]
  for (let depth = 0; ancestors.length > 0; depth++) {
    if (ancestors.includes(itemId)) throw cyclicMove()
    if (depth >= MAX_ANCESTOR_DEPTH) {
      throw new ToolError(
        "invalid_argument",
        `The destination's ancestors could not be followed within ${MAX_ANCESTOR_DEPTH} levels; the folder cannot be moved safely.`,
      )
    }
    const parents = new Set<string>()
    for (const id of ancestors) {
      if (id === ROOT_FOLDER) continue
      const ancestor = await readItem(client, id)
      if (ancestor.id === itemId) throw cyclicMove()
      for (const parent of ancestor.parents ?? []) parents.add(parent)
    }
    ancestors = [...parents]
  }
}

function takenFromOthers(itemId: string, where: string): ToolError {
  return new ToolError(
    "forbidden",
    `The item ${itemId} is in ${where}; moving it would take it from the people there, and these tools never change sharing.`,
  )
}

/**
 * The folder `id` that the item is in, which may be left only when no one else
 * can reach it: not in a shared drive, and its permissions listed and the
 * account's own alone (a folder whose permissions cannot be listed counts as
 * shared), else `forbidden`.
 */
async function readParent(
  client: GoogleClient,
  itemId: string,
  id: string,
  accountEmail: string | null,
): Promise<ParentFolder> {
  const folder = await readItem(client, id)
  if (folder.driveId !== undefined) throw takenFromOthers(itemId, "a shared drive")
  if (accountEmail === null) {
    throw new ToolError(
      "forbidden",
      `The account's address is not recorded, so it cannot be told whether the folder ${id} that ${itemId} is in is shared; log the account in again.`,
    )
  }
  const sharing = await readSharing(client, id)
  if (sharing.permissions === null || isShared(sharing.permissions, [accountEmail], folder.driveId)) {
    throw takenFromOthers(itemId, `the shared folder ${id}`)
  }
  return {
    id,
    name: folder.name ?? "",
    pin: folderPin(id, folder.driveId, folder.trashed === true, sharing.permissions),
  }
}

/** Whether the item is in the destination and nowhere else, so that a move would change nothing. */
export function isAlreadyThere({ parents, destination }: Pick<MovePlan, "parents" | "destination">): boolean {
  return parents.length === 1 && parents[0]!.id === destination.id
}

/** One digest of every folder the item is in now, with its sharing: a prompt keeps few pins, and an item may have several parents. */
export function parentsDigest(parents: readonly ParentFolder[]): string {
  return createHash("sha256")
    .update(parents.map(({ id, pin }) => `${id}:${pin}`).join("\n"))
    .digest("hex")
}

/**
 * Reads and checks what a move is made of, in this order: the ids, the label's
 * scopes (before any request), the item (not in a shared drive, and in a
 * folder Google shows: an item whose parents are hidden is someone else's,
 * and leaving its folder unread could take it from people there), the
 * destination (see `readDestination`: the upload's rules), its ancestors for
 * a folder move (up to `MAX_ANCESTOR_DEPTH` levels, refusing a cycle or an
 * unfinished walk as `invalid_argument`) and each folder the
 * item is in now (see `readParent`); the destination counts as one when the
 * item is in it. Any refusal here fails the call before anything is moved.
 */
export async function planMove(args: DriveMoveArgs, ctx: ToolContext): Promise<MovePlan> {
  const fileId = driveId(args.file_id, "file id")
  const folder = folderId(args.folder)
  const { client, label } = await driveWriteSession(ctx, args.account, DRIVE_ROUTES.update)
  const item = await readItem(client, fileId)
  if (item.driveId !== undefined) throw takenFromOthers(item.id, "a shared drive")
  if ((item.parents ?? []).length === 0) throw takenFromOthers(item.id, "a folder Google does not show this account")

  const accountEmail = await client.accountEmail()
  const destination = await readDestination(client, folder, accountEmail)
  if (itemKind(item) === "folder" && item.id === destination.id) throw cyclicMove()
  if (itemKind(item) === "folder") await checkAncestors(client, item.id, destination)

  const parents: ParentFolder[] = []
  for (const id of item.parents ?? []) {
    parents.push(
      id === destination.id
        ? { id, name: folderName(destination), pin: destination.pin }
        : await readParent(client, item.id, id, accountEmail),
    )
  }
  return { client, label, item, destination, parents }
}
