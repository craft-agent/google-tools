import { z } from "zod"
import { PERMISSION_TYPES, type AccessEntry } from "./schemas"

/** The type of a permission that names one person: the only kind that is the owner's own. */
const USER_TYPE = "user"

/** The types whose permission can be left undiscoverable: a link alone reaches the file. */
const DISCOVERABLE_TYPES: readonly string[] = ["anyone", "domain"]

export const permissionReply = z.object({
  id: z.string().optional(),
  type: z.enum(PERMISSION_TYPES),
  role: z.string(),
  emailAddress: z.string().optional(),
  domain: z.string().optional(),
  allowFileDiscovery: z.boolean().optional(),
  displayName: z.string().optional(),
  permissionDetails: z
    .array(z.object({ inherited: z.boolean().optional(), inheritedFrom: z.string().optional() }))
    .optional(),
})

export type Permission = z.output<typeof permissionReply>

/**
 * Whether a file or folder can be reached by anyone besides the account that
 * owns it: it is in a shared drive (`driveId`), or it has a permission that is
 * not an owner's own (`ownerEmails`, compared ignoring case). A permission
 * list cut short still says `true` as soon as it shows one.
 */
export function isShared(
  permissions: readonly Pick<Permission, "type" | "emailAddress">[],
  ownerEmails: readonly string[],
  driveId: string | null | undefined,
): boolean {
  if (driveId) return true
  const owners = new Set(ownerEmails.map((email) => email.toLowerCase()))
  return permissions.some(
    (permission) =>
      permission.type !== USER_TYPE ||
      permission.emailAddress === undefined ||
      !owners.has(permission.emailAddress.toLowerCase()),
  )
}

/** One permission as a result lists it; it is `inherited` only when every grant it holds comes from a folder above. */
export function accessEntry(permission: Permission): AccessEntry {
  const details = permission.permissionDetails ?? []
  const inherited = details.every((detail) => detail.inherited === true)
  const origin = details.find((detail) => detail.inheritedFrom !== undefined)
  return {
    type: permission.type,
    role: permission.role,
    ...(permission.emailAddress !== undefined && { email: permission.emailAddress }),
    ...(permission.domain !== undefined && { domain: permission.domain }),
    ...(permission.displayName !== undefined && { name: permission.displayName }),
    ...(permission.allowFileDiscovery !== undefined &&
      DISCOVERABLE_TYPES.includes(permission.type) && { discoverable: permission.allowFileDiscovery }),
    ...(details.length > 0 && { inherited }),
    ...(inherited && origin?.inheritedFrom !== undefined && { inherited_from: origin.inheritedFrom }),
  }
}
