import { z } from "zod"
import { accountArg } from "../sheets/schemas"
import { folderArg, nameArg } from "./write-args"

export const driveFolderCreateInput = z.strictObject({
  account: accountArg,
  name: nameArg("The name of the new folder."),
  folder: folderArg("to create it in"),
})

export const driveFolderCreateOutput = z.object({
  folder_id: z.string().describe("The id of the new folder; empty if Google did not report it."),
  name: z.string().describe("The name the folder has in Drive."),
  parent_id: z.string().describe("The id of the folder it is in; for My Drive, the id of its top folder."),
  web_view_link: z.string().nullable().describe("A link that opens it for a person who may open it; null if none."),
})

export type DriveFolderCreateArgs = z.output<typeof driveFolderCreateInput>
export type DriveFolderCreateResult = z.output<typeof driveFolderCreateOutput>
