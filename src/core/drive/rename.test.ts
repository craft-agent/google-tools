import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import type { FakeHandler } from "../google/fake-google.testing"
import {
  FILE_ID,
  FOLDER_ID,
  callOf,
  cleanUp,
  fileUrl,
  folderHandler,
  freshTokens,
  itemHandler,
  patchHandler,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

/** The handler that takes a rename and answers with the new name. */
const renames = (id = FILE_ID): FakeHandler => ({
  method: "PATCH",
  url: fileUrl(id),
  reply: (request) => ({ json: { id, name: (request.json as { name: string }).name } }),
})

describe("google_drive_rename requests", () => {
  test("sends the new name in one PATCH of the file, and returns it", async () => {
    const h = await writeFixture({ handlers: [itemHandler(FILE_ID), renames()] })
    expect(await h.rename.run({ file_id: FILE_ID, name: "Budget 2027.pdf" })).toEqual({
      file_id: FILE_ID,
      name: "Budget 2027.pdf",
    })
    const [write] = h.writes()
    expect(callOf(write!)).toBe(`PATCH ${fileUrl(FILE_ID)}`)
    expect(Object.fromEntries(write!.url.searchParams)).toEqual({ supportsAllDrives: "true", fields: "id,name" })
    expect(write!.json).toEqual({ name: "Budget 2027.pdf" })
  })

  test("renames a folder the same way", async () => {
    const h = await writeFixture({ handlers: [folderHandler(FOLDER_ID), renames(FOLDER_ID)] })
    expect((await h.rename.run({ file_id: FOLDER_ID, name: "Archive" })).name).toBe("Archive")
  })

  test("the name it has already is sent all the same, and the result is the same again", async () => {
    const h = await writeFixture({ handlers: [itemHandler(FILE_ID), renames()] })
    const first = await h.rename.run({ file_id: FILE_ID, name: "Budget 2026.pdf" })
    expect(await h.rename.run({ file_id: FILE_ID, name: "Budget 2026.pdf" })).toEqual(first)
    expect(h.writes()).toHaveLength(2)
  })

  test("reports the name asked for when Google's answer lacks one", async () => {
    const h = await writeFixture({ handlers: [itemHandler(FILE_ID), patchHandler(FILE_ID, { json: {} })] })
    expect(await h.rename.run({ file_id: FILE_ID, name: "New" })).toEqual({ file_id: FILE_ID, name: "New" })
  })

  test.each([
    ["an empty name", { file_id: FILE_ID, name: "" }],
    ["a name over 500 characters", { file_id: FILE_ID, name: "x".repeat(501) }],
    ["a name with a control character", { file_id: FILE_ID, name: "a\u0007b" }],
    ["root as the file", { file_id: "root", name: "x" }],
    ["a file id that is not an id", { file_id: "a b", name: "x" }],
  ])("%s is refused before any request", async (_what, args) => {
    const h = await writeFixture({ handlers: [itemHandler(FILE_ID), renames()] })
    expect((await toolError(h.rename.run(args))).code).toBe("invalid_argument")
    expect(h.calls()).toEqual([])
  })

  test("a file that is gone is not_found, and nothing is sent", async () => {
    const h = await writeFixture({
      handlers: [
        { method: "GET", url: fileUrl(FILE_ID), reply: { status: 404, json: { error: { status: "NOT_FOUND" } } } },
      ],
    })
    expect((await toolError(h.rename.run({ file_id: FILE_ID, name: "x" }))).code).toBe("not_found")
    expect(h.writes()).toEqual([])
  })
})

describe("google_drive_rename prompt", () => {
  test("headlines the old name and the new one, shows the kind and pins the old name", async () => {
    const h = await writeFixture({ handlers: [itemHandler(FILE_ID)] })
    expect(await h.rename.describe({ file_id: FILE_ID, name: "Budget 2027.pdf" })).toEqual({
      headline: {
        text: "About to rename {old} to {new}",
        values: { old: "Budget 2026.pdf", new: "Budget 2027.pdf" },
      },
      facts: [{ label: "Type", value: "file" }],
      pins: { name: "Budget 2026.pdf" },
    })
  })

  test("a folder is shown as a folder, and the pin follows the name it has now", async () => {
    const h = await writeFixture({ handlers: [folderHandler(FOLDER_ID, { name: "Projects (old)" })] })
    const description = await h.rename.describe({ file_id: FOLDER_ID, name: "Projects" })
    expect(description.facts).toEqual([{ label: "Type", value: "folder" }])
    expect(description.pins).toEqual({ name: "Projects (old)" })
  })

  test("the target is the file, by the id given, without reading it", async () => {
    const h = await writeFixture()
    expect(await h.rename.targets({ file_id: FILE_ID, name: "x" })).toEqual([`work/files/${FILE_ID}`])
    expect(h.calls()).toEqual([])
    expect(await h.rename.targets({ file_id: "a/b", name: "x" })).toEqual(["*"])
  })
})
