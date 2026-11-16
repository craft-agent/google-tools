import { createHash } from "node:crypto"
import { z } from "zod"
import { ToolError } from "../errors"
import type { GoogleClient } from "../google/client"
import { canonicalJson } from "../pin"
import { parseReply } from "../sheets/reply"
import { readSharing } from "./file"
import { SUPPORTS_ALL_DRIVES, fileReply } from "./file-view"
import { ROOT_FOLDER } from "./ids"
import { FOLDER_MIME_TYPE } from "./kinds"
import { DRIVE_ROUTES } from "./routes"
import { quoted } from "./search"
import { isShared } from "./sharing"

/** The fields of a folder an upload decides on. */
const FOLDER_FIELDS = "id,name,mimeType,driveId,trashed,owners(emailAddress)"

/** The fields of the top of My Drive. */
const ROOT_FIELDS = "id,name"

/** How many files of the same name are counted; more than this is not told apart. */
export const MAX_COUNTED_FILES = 10

const rootReply = z.object({ id: z.string(), name: z.string().optional() })

const sameNameReply = z.object({ files: z.array(z.object({ id: z.string() })).optional() })

/** Where an upload goes: the folder's real id, the name the prompt shows for it (none for the top of My Drive) and a digest of its sharing. */
export type Destination = {
  id: string
  name: string | null
  /** What the call must still find unchanged: for the top of My Drive its id, else a digest of the folder's id, drive, trash state and permissions. */
  pin: string
}

function sharedFolder(id: string): ToolError {
  return new ToolError(
    "forbidden",
    `The folder ${id} is shared (or in a shared drive); putting a file there shares it with everyone who reaches it, and these tools never change sharing.`,
  )
}

/** The pin of a folder: a digest of its id, the shared drive it is in, its trash state and its permissions' ids, roles and types. */
export function folderPin(
  id: string,
  driveId: string | undefined,
  trashed: boolean,
  permissions: readonly { id?: string; role: string; type: string }[],
): string {
  const grants = permissions.map(({ id: grant = "", role, type }) => `${grant}:${role}:${type}`).sort()
  return createHash("sha256")
    .update(canonicalJson({ id, driveId: driveId ?? null, trashed, permissions: grants }))
    .digest("hex")
}

/** The top of My Drive, whose real id is the target and the pin: it is the account's own and nobody else's. */
async function readRoot(client: GoogleClient): Promise<Destination> {
  const root = parseReply(
    rootReply,
    await client.request(DRIVE_ROUTES.file, {
      params: { file_id: ROOT_FOLDER },
      query: { ...SUPPORTS_ALL_DRIVES, fields: ROOT_FIELDS },
    }),
    "the top of My Drive",
  )
  return { id: root.id, name: null, pin: root.id }
}

/**
 * The folder `folder` names, which an upload may go into only when it is a
 * folder, not in the trash, not in a shared drive, owned by the account
 * (`accountEmail`, which must be known) and reachable by no one else:
 * otherwise `forbidden`. A folder whose permissions cannot be listed counts as
 * shared. Every page of its permissions is read, up to the limit `readSharing`
 * keeps.
 */
async function readFolder(client: GoogleClient, folder: string, accountEmail: string | null): Promise<Destination> {
  const found = parseReply(
    fileReply,
    await client.request(DRIVE_ROUTES.file, {
      params: { file_id: folder },
      query: { ...SUPPORTS_ALL_DRIVES, fields: FOLDER_FIELDS },
    }),
    "the folder",
  )
  if (found.mimeType !== FOLDER_MIME_TYPE) throw new ToolError("forbidden", `${folder} is not a folder.`)
  if (found.trashed === true) throw new ToolError("forbidden", `The folder ${folder} is in the trash.`)
  if (found.driveId !== undefined) throw sharedFolder(folder)
  if (accountEmail === null) {
    throw new ToolError(
      "forbidden",
      `The account's address is not recorded, so it cannot be told whether the folder ${folder} is the account's own; log the account in again.`,
    )
  }
  const own = accountEmail.toLowerCase()
  if (!(found.owners ?? []).some((owner) => owner.emailAddress?.toLowerCase() === own)) throw sharedFolder(folder)

  const sharing = await readSharing(client, found.id)
  if (sharing.permissions === null || isShared(sharing.permissions, [accountEmail], found.driveId)) {
    throw sharedFolder(folder)
  }
  return { id: found.id, name: found.name ?? "", pin: folderPin(found.id, found.driveId, false, sharing.permissions) }
}

/** Where `folder` (an id, or `root`) sends an upload, after the rules of `readFolder`; the top of My Drive is always allowed. */
export async function readDestination(
  client: GoogleClient,
  folder: string,
  accountEmail: string | null,
): Promise<Destination> {
  return folder === ROOT_FOLDER ? readRoot(client) : readFolder(client, folder, accountEmail)
}

/** How many files named `name` are in the folder `destination` and not in the trash, up to `MAX_COUNTED_FILES`. */
export async function countSameName(client: GoogleClient, destination: Destination, name: string): Promise<number> {
  const listed = parseReply(
    sameNameReply,
    await client.request(DRIVE_ROUTES.files, {
      query: {
        ...SUPPORTS_ALL_DRIVES,
        q: `name = ${quoted(name)} and '${destination.id}' in parents and trashed = false`,
        pageSize: MAX_COUNTED_FILES,
        fields: "files(id)",
      },
    }),
    "the files with the same name",
  )
  return listed.files?.length ?? 0
}
