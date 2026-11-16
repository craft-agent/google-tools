import { z } from "zod"
import { isToolError } from "../errors"
import type { GoogleClient } from "../google/client"
import { parseReply } from "../sheets/reply"
import { SUPPORTS_ALL_DRIVES, fetchFile, fileReply, fileView } from "./file-view"
import { DRIVE_ROUTES } from "./routes"
import {
  MAX_PERMISSION_PAGES,
  PERMISSIONS_PAGE_SIZE,
  type AccessEntry,
  type Capabilities,
  type FileResult,
} from "./schemas"
import { accessEntry, isShared, permissionReply, type Permission } from "./sharing"

const PERMISSION_FIELDS =
  "permissions(id,type,role,emailAddress,domain,allowFileDiscovery,displayName,permissionDetails(inherited,inheritedFrom,role)),nextPageToken"

/** The fields only a single file read asks for, beside the view's. */
const DETAIL_FIELDS = "description,capabilities(canEdit,canShare,canTrash,canDownload)"

const HTTP_FORBIDDEN = 403

const SHARING_HIDDEN_NOTE = "Google shows the sharing only to people who can share this file."

const permissionsReply = z.object({
  permissions: z.array(permissionReply).optional(),
  nextPageToken: z.string().optional(),
})

const detailReply = fileReply.extend({
  description: z.string().optional(),
  capabilities: z
    .object({
      canEdit: z.boolean().optional(),
      canShare: z.boolean().optional(),
      canTrash: z.boolean().optional(),
      canDownload: z.boolean().optional(),
    })
    .optional(),
})

/** What the file read adds to the view that a listing leaves out. */
export type Sharing = { access: AccessEntry[] | null; note?: string; permissions: Permission[] | null }

/** Whether a failure is Google refusing to show the sharing, which Drive words as a 403 whatever its reason; a rate limit is not. */
function isSharingRefusal(error: unknown): boolean {
  return isToolError(error) && error.details?.status === HTTP_FORBIDDEN && error.code !== "rate_limited"
}

/**
 * The file's permissions, up to `MAX_PERMISSION_PAGES` pages. A 403 on the
 * first page is Google showing the sharing only to those who can share the
 * file, so it is no failure: the list is `null`, with a note saying so.
 */
export async function readSharing(client: GoogleClient, fileId: string): Promise<Sharing> {
  const permissions: Permission[] = []
  let pageToken: string | undefined
  for (let page = 1; page <= MAX_PERMISSION_PAGES; page++) {
    let reply: z.output<typeof permissionsReply>
    try {
      reply = parseReply(
        permissionsReply,
        await client.request(DRIVE_ROUTES.permissions, {
          params: { file_id: fileId },
          query: { ...SUPPORTS_ALL_DRIVES, pageSize: PERMISSIONS_PAGE_SIZE, pageToken, fields: PERMISSION_FIELDS },
        }),
        "the permission list",
      )
    } catch (error) {
      if (page === 1 && isSharingRefusal(error)) return { access: null, note: SHARING_HIDDEN_NOTE, permissions: null }
      throw error
    }
    permissions.push(...(reply.permissions ?? []))
    pageToken = reply.nextPageToken
    if (pageToken === undefined) return { access: permissions.map(accessEntry), permissions }
  }
  return {
    access: permissions.map(accessEntry),
    note: `Only the first ${permissions.length} permissions are listed.`,
    permissions,
  }
}

function capabilitiesOf(reply: z.output<typeof detailReply>["capabilities"]): Capabilities {
  return {
    can_edit: reply?.canEdit ?? false,
    can_share: reply?.canShare ?? false,
    can_trash: reply?.canTrash ?? false,
    can_download: reply?.canDownload ?? false,
  }
}

/**
 * One file's view with its description, what the account may do with it and
 * who can reach it. A folder also says whether `reachable` only by the account
 * or by others: others when it is in a shared drive, when a permission is not
 * the owner's own, and when Google hides the sharing, since the owner always
 * sees it.
 */
export async function readFile(client: GoogleClient, fileId: string): Promise<FileResult> {
  const file = await fetchFile(client, fileId, detailReply, DETAIL_FIELDS)
  const view = fileView(file)
  const sharing = await readSharing(client, file.id)
  const shared = sharing.permissions === null || isShared(sharing.permissions, view.owners, view.drive_id)
  return {
    ...view,
    description: file.description ?? null,
    capabilities: capabilitiesOf(file.capabilities),
    access: sharing.access,
    ...(sharing.note !== undefined && { access_note: sharing.note }),
    ...(view.kind === "folder" && { reachable: shared ? "shared" : "only_you" }),
  }
}
