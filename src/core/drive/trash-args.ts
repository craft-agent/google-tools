import { z } from "zod"
import { accountArg } from "../sheets/schemas"

/** The most files and folders one trash or restore call changes. */
export const MAX_TRASH_ITEMS = 100

/** How many days Drive keeps an item in the trash before it deletes it. */
export const TRASH_RETENTION_DAYS = 30

/** What a trash and a restore name: the files and folders, each once. */
function fileIdsArg(action: string) {
  return z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_TRASH_ITEMS)
    .describe(
      `The files and folders to ${action}, 1 to ${MAX_TRASH_ITEMS} \`file_id\`s as \`google_drive_read\` gives them; each is changed once, in the order given.`,
    )
}

/** The failure after earlier items were changed, with the reason. */
const errorsOutput = z
  .record(z.string(), z.string())
  .optional()
  .describe(
    "The id whose change failed after earlier ones were made, with the reason; the ids after it were not tried.",
  )

export const driveTrashInput = z.strictObject({ account: accountArg, file_ids: fileIdsArg("move to the trash") })

export const driveTrashOutput = z.object({
  trashed: z.number().int().describe("How many items were moved to the trash."),
  ids: z.array(z.string()).describe("The ids of those, in the order given."),
  skipped: z
    .array(z.string())
    .describe("The ids that were in the trash already, left as they were, in the order given."),
  errors: errorsOutput,
})

export const driveRestoreInput = z.strictObject({ account: accountArg, file_ids: fileIdsArg("restore from the trash") })

export const driveRestoreOutput = z.object({
  restored: z.number().int().describe("How many items were taken out of the trash."),
  ids: z.array(z.string()).describe("The ids of those, in the order given."),
  skipped: z.array(z.string()).describe("The ids that were not in the trash, left as they were, in the order given."),
  errors: errorsOutput,
})

export type DriveTrashArgs = z.output<typeof driveTrashInput>
export type DriveTrashResult = z.output<typeof driveTrashOutput>
export type DriveRestoreArgs = z.output<typeof driveRestoreInput>
export type DriveRestoreResult = z.output<typeof driveRestoreOutput>
