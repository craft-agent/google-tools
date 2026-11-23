import { z } from "zod"
import { accountArg } from "../sheets/schemas"
import { fileIdArg, folderArg, nameArg } from "./write-args"

export const driveCopyInput = z.strictObject({
  account: accountArg,
  file_id: fileIdArg("the file to copy (not a folder or a shortcut)"),
  folder: folderArg("to put the copy in"),
  name: nameArg("The name of the copy; left out, the copy keeps the file's name.").optional(),
})

export const driveCopyOutput = z.object({
  file_id: z.string().describe("The id of the copy; empty if Google did not report it."),
  name: z.string().describe("The name the copy has in Drive."),
  mime_type: z.string().describe("Its media type."),
  folder_id: z.string().describe("The id of the folder it is in; for My Drive, the id of its top folder."),
  web_view_link: z.string().nullable().describe("A link that opens it for a person who may open it; null if none."),
})

export type DriveCopyArgs = z.output<typeof driveCopyInput>
export type DriveCopyResult = z.output<typeof driveCopyOutput>
