import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import type { FakeHandler } from "../google/fake-google.testing"
import {
  FILES_URL,
  FILE_ID,
  FOLDER_ID,
  NEW_FILE_ID,
  ROOT_ID,
  answer,
  callOf,
  cleanUp,
  fileUrl,
  freshTokens,
  itemHandler,
  ownFolderHandlers,
  permissionsUrl,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const COPY_URL = `${fileUrl(FILE_ID)}/copy`

/** The handler that takes the copy and answers with it, named as the request names it or the source's name. */
const copies = (parent = ROOT_ID): FakeHandler => ({
  method: "POST",
  url: COPY_URL,
  reply: (request) => ({
    json: {
      id: NEW_FILE_ID,
      name: (request.json as { name?: string }).name ?? "Budget 2026.pdf",
      mimeType: "application/pdf",
      parents: [parent],
      webViewLink: `https://drive.google.com/file/d/${NEW_FILE_ID}/view`,
    },
  }),
})

const sharedFolder = [
  ownFolderHandlers()[0]!,
  answer(permissionsUrl(FOLDER_ID), { permissions: [{ id: "p2", type: "anyone", role: "reader" }] }),
]

describe("google_drive_copy requests", () => {
  test("leaves the name out so that the copy keeps the source's name, and puts it in the top folder", async () => {
    const h = await writeFixture({ handlers: [itemHandler(FILE_ID), copies()] })
    const result = await h.copy.run({ file_id: FILE_ID })
    expect(result).toEqual({
      file_id: NEW_FILE_ID,
      name: "Budget 2026.pdf",
      mime_type: "application/pdf",
      folder_id: ROOT_ID,
      web_view_link: `https://drive.google.com/file/d/${NEW_FILE_ID}/view`,
    })

    const [write] = h.writes()
    expect(callOf(write!)).toBe(`POST ${COPY_URL}`)
    expect(Object.fromEntries(write!.url.searchParams)).toEqual({
      supportsAllDrives: "true",
      fields: "id,name,mimeType,parents,webViewLink",
    })
    expect(write!.json).toEqual({ parents: [ROOT_ID] })
    expect(Object.hasOwn(write!.json as object, "name")).toBe(false)
  })

  test("names the copy and puts it in an own folder when asked", async () => {
    const h = await writeFixture({ handlers: [itemHandler(FILE_ID), ...ownFolderHandlers(), copies(FOLDER_ID)] })
    const result = await h.copy.run({ file_id: FILE_ID, folder: FOLDER_ID, name: "Budget backup" })
    expect(result).toMatchObject({ name: "Budget backup", folder_id: FOLDER_ID })
    expect(h.writes()[0]!.json).toEqual({ name: "Budget backup", parents: [FOLDER_ID] })
  })

  test("reads the source for its copy right, version, type, size and name", async () => {
    const h = await writeFixture({ handlers: [itemHandler(FILE_ID), copies()] })
    await h.copy.run({ file_id: FILE_ID })
    const read = h.calls().find((call) => call.url.pathname === `/drive/v3/files/${FILE_ID}` && call.method === "GET")!
    const fields = read.url.searchParams.get("fields")!
    for (const field of ["capabilities(canCopy)", "version", "mimeType", "size", "name"])
      expect(fields).toContain(field)
  })
})

describe("google_drive_copy refusals", () => {
  test.each([
    ["a folder", { mimeType: "application/vnd.google-apps.folder" }, "invalid_argument", "which Drive cannot copy"],
    ["a shortcut", { mimeType: "application/vnd.google-apps.shortcut" }, "invalid_argument", "is a shortcut"],
    [
      "a file the account may not copy",
      { capabilities: { canCopy: false } },
      "forbidden",
      "does not let the account copy",
    ],
  ])("%s is refused, and nothing is copied", async (_what, extra, code, message) => {
    const h = await writeFixture({ handlers: [itemHandler(FILE_ID, extra), copies()] })
    const error = await toolError(h.copy.run({ file_id: FILE_ID }))
    expect(error).toMatchObject({ code })
    expect(error.message).toContain(message)
    expect(h.writes()).toEqual([])
  })

  test("a file whose capabilities Google does not report is not refused", async () => {
    const h = await writeFixture({ handlers: [itemHandler(FILE_ID, { capabilities: undefined }), copies()] })
    expect((await h.copy.run({ file_id: FILE_ID })).file_id).toBe(NEW_FILE_ID)
  })

  test("a shared destination is refused with the upload's rule", async () => {
    const h = await writeFixture({ handlers: [itemHandler(FILE_ID), ...sharedFolder, copies()] })
    const error = await toolError(h.copy.run({ file_id: FILE_ID, folder: FOLDER_ID }))
    expect(error).toMatchObject({ code: "forbidden" })
    expect(error.message).toContain("is shared (or in a shared drive)")
    expect(h.writes()).toEqual([])
  })

  test.each([
    ["a file id that is not an id", { file_id: "a/b" }],
    ["root as the file", { file_id: "root" }],
    ["a name with a control character", { file_id: FILE_ID, name: "a\tb" }],
    ["an unknown argument", { file_id: FILE_ID, sharing: "anyone" }],
  ])("%s is refused before any request", async (_what, args) => {
    const h = await writeFixture({ handlers: [itemHandler(FILE_ID), copies()] })
    expect((await toolError(h.copy.run(args))).code).toBe("invalid_argument")
    expect(h.calls()).toEqual([])
  })
})

describe("google_drive_copy prompt", () => {
  test("headlines the folder, names the source and its size, and pins its version and the folder", async () => {
    const h = await writeFixture({ handlers: [itemHandler(FILE_ID)] })
    expect(await h.copy.describe({ file_id: FILE_ID })).toEqual({
      headline: { text: "About to copy a file to {folder}", values: { folder: "My Drive" } },
      facts: [
        { label: "Source", value: "Budget 2026.pdf" },
        { label: "Size", value: { text: "{bytes} bytes", values: { bytes: 2048 } } },
      ],
      pins: { version: "7", folder: ROOT_ID },
    })
  })

  test("says how many files carry the given name already", async () => {
    const h = await writeFixture({ handlers: [itemHandler(FILE_ID), answer(FILES_URL, { files: [{ id: "a" }] })] })
    const named = await h.copy.describe({ file_id: FILE_ID, name: "Budget" })
    expect(named.facts.at(-1)).toEqual({
      label: "Already there",
      value: { text: "{count} file named so", values: { count: 1 } },
    })
  })

  test("counts files of the source's name when no name is given", async () => {
    const h = await writeFixture({
      handlers: [itemHandler(FILE_ID), answer(FILES_URL, { files: [{ id: "a" }, { id: "b" }] })],
    })
    expect((await h.copy.describe({ file_id: FILE_ID })).facts.at(-1)).toEqual({
      label: "Already there",
      value: { text: "{count} files named so", values: { count: 2 } },
    })
    const counted = h.calls().find((call) => call.url.pathname === "/drive/v3/files")!
    expect(counted.url.searchParams.get("q")).toContain("name = 'Budget 2026.pdf'")
  })

  test("does not count files when neither the argument nor the source gives a name", async () => {
    const h = await writeFixture({ handlers: [itemHandler(FILE_ID, { name: undefined })] })
    expect((await h.copy.describe({ file_id: FILE_ID })).facts).toHaveLength(2)
    expect(h.calls().some((call) => call.url.pathname === "/drive/v3/files")).toBe(false)
  })

  test("the version pin changes when the source does", async () => {
    const pinFor = async (version: string) => {
      const h = await writeFixture({ handlers: [itemHandler(FILE_ID, { version })] })
      return (await h.copy.describe({ file_id: FILE_ID })).pins
    }
    expect(await pinFor("8")).not.toEqual(await pinFor("7"))
    expect(await pinFor("7")).toEqual(await pinFor("7"))
  })

  test("the target is the destination folder's real id", async () => {
    const h = await writeFixture({ handlers: [itemHandler(FILE_ID), ...ownFolderHandlers()] })
    expect(await h.copy.targets({ file_id: FILE_ID })).toEqual([`work/folders/${ROOT_ID}`])
    expect(await h.copy.targets({ file_id: FILE_ID, folder: FOLDER_ID })).toEqual([`work/folders/${FOLDER_ID}`])
  })
})
