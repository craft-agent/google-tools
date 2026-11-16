import { z } from "zod"
import { accountArg } from "../sheets/schemas"
import { ROOT_FOLDER } from "./ids"
import { fileIdArg } from "./write-args"

export const driveMoveInput = z.strictObject({
  account: accountArg,
  file_id: fileIdArg("the file or folder to move"),
  folder: z
    .string()
    .min(1)
    .describe(
      `The folder to move it to: its id, or \`${ROOT_FOLDER}\` for the top of My Drive. It must be the account's own and shared with no one, not in the trash and not in a shared drive.`,
    ),
})

export const driveMoveOutput = z.object({
  file_id: z.string().describe("The id of the file or folder."),
  name: z.string().describe("Its name."),
  folder_id: z.string().describe("The id of the folder it is in now; for My Drive, the id of its top folder."),
  moved: z.boolean().describe("False when it was in that folder already, and nothing was sent."),
})

export type DriveMoveArgs = z.output<typeof driveMoveInput>
export type DriveMoveResult = z.output<typeof driveMoveOutput>
