import { z } from "zod"
import { accountArg } from "../sheets/schemas"
import { fileIdArg, nameArg } from "./write-args"

export const driveRenameInput = z.strictObject({
  account: accountArg,
  file_id: fileIdArg("the file or folder to rename"),
  name: nameArg("The new name."),
})

export const driveRenameOutput = z.object({
  file_id: z.string().describe("The id of the file or folder."),
  name: z.string().describe("The name it has now."),
})

export type DriveRenameArgs = z.output<typeof driveRenameInput>
export type DriveRenameResult = z.output<typeof driveRenameOutput>
