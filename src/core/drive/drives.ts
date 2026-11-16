import { z } from "zod"
import type { GoogleClient } from "../google/client"
import { parseReply } from "../sheets/reply"
import { DRIVE_ROUTES } from "./routes"
import { DEFAULT_DRIVES_LIMIT, type DriveReadArgs, type DrivesResult } from "./schemas"

const DRIVE_FIELDS = "nextPageToken,drives(id,name,createdTime)"

const drivesReply = z.object({
  drives: z
    .array(z.object({ id: z.string(), name: z.string().optional(), createdTime: z.string().optional() }))
    .optional(),
  nextPageToken: z.string().optional(),
})

/** The shared drives the account is a member of, filtered by the Drive query `query` when given. */
export async function listDrives(
  client: GoogleClient,
  args: Pick<DriveReadArgs, "query" | "limit" | "page_token">,
): Promise<DrivesResult> {
  const listed = parseReply(
    drivesReply,
    await client.request(DRIVE_ROUTES.drives, {
      query: {
        q: args.query,
        pageSize: args.limit ?? DEFAULT_DRIVES_LIMIT,
        pageToken: args.page_token,
        fields: DRIVE_FIELDS,
      },
    }),
    "the shared drive list",
  )
  return {
    drives: (listed.drives ?? []).map((drive) => ({
      drive_id: drive.id,
      name: drive.name ?? "",
      ...(drive.createdTime !== undefined && { created_time: drive.createdTime }),
    })),
    next_page_token: listed.nextPageToken ?? null,
  }
}
