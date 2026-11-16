import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { FakeHandler } from "../google/fake-google.testing"
import {
  FILE_ID,
  FOLDER_ID,
  OTHER_FOLDER_ID,
  ROOT_ID,
  answer,
  callOf,
  cleanUp,
  fileUrl,
  freshTokens,
  itemHandler,
  ownFolderHandlers,
  patchHandler,
  permissionsUrl,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

/** The handler that takes a move and answers with the item in the folder named by `addParents`. */
const moves: FakeHandler = {
  method: "PATCH",
  url: fileUrl(FILE_ID),
  reply: (request) => ({
    json: { id: FILE_ID, name: "Budget 2026.pdf", parents: [request.url.searchParams.get("addParents")] },
  }),
}

/** The handlers of the folder the item is in, its parent: an own folder that no one else can reach. */
const parent = (id = FOLDER_ID, name = "Projects") => ownFolderHandlers(id, { name })

describe("google_drive_move requests", () => {
  test("adds the destination and removes the current parent in one PATCH with an empty body", async () => {
    const h = await writeFixture({ handlers: [itemHandler(FILE_ID), ...parent(), moves] })
    expect(await h.move.run({ file_id: FILE_ID, folder: "root" })).toEqual({
      file_id: FILE_ID,
      name: "Budget 2026.pdf",
      folder_id: ROOT_ID,
      moved: true,
    })
    const [write] = h.writes()
    expect(callOf(write!)).toBe(`PATCH ${fileUrl(FILE_ID)}`)
    expect(Object.fromEntries(write!.url.searchParams)).toEqual({
      supportsAllDrives: "true",
      addParents: ROOT_ID,
      removeParents: FOLDER_ID,
      fields: "id,name,parents",
    })
    expect(write!.json).toEqual({})
  })

  test("moves from the top of My Drive into an own folder", async () => {
    const h = await writeFixture({
      handlers: [itemHandler(FILE_ID, { parents: [ROOT_ID] }), ...parent(ROOT_ID, "My Drive"), ...parent(), moves],
    })
    expect((await h.move.run({ file_id: FILE_ID, folder: FOLDER_ID })).folder_id).toBe(FOLDER_ID)
    const query = Object.fromEntries(h.writes()[0]!.url.searchParams)
    expect(query).toMatchObject({ addParents: FOLDER_ID, removeParents: ROOT_ID })
  })

  test("removeParents lists every current parent, each of them checked", async () => {
    const h = await writeFixture({
      handlers: [
        itemHandler(FILE_ID, { parents: [FOLDER_ID, OTHER_FOLDER_ID] }),
        ...parent(),
        ...parent(OTHER_FOLDER_ID, "Archive"),
        moves,
      ],
    })
    await h.move.run({ file_id: FILE_ID, folder: "root" })
    expect(h.writes()[0]!.url.searchParams.get("removeParents")).toBe(`${FOLDER_ID},${OTHER_FOLDER_ID}`)
    const listed = h.calls().filter((call) => call.url.pathname.endsWith("/permissions"))
    expect(listed.map((call) => call.url.pathname).sort()).toEqual(
      [permissionsUrl(FOLDER_ID), permissionsUrl(OTHER_FOLDER_ID)].map((url) => new URL(url).pathname).sort(),
    )
  })

  test("an item already in that folder alone sends nothing and says moved: false", async () => {
    const h = await writeFixture({ handlers: [itemHandler(FILE_ID, { parents: [ROOT_ID] }), moves] })
    expect(await h.move.run({ file_id: FILE_ID, folder: "root" })).toEqual({
      file_id: FILE_ID,
      name: "Budget 2026.pdf",
      folder_id: ROOT_ID,
      moved: false,
    })
    expect(h.writes()).toEqual([])
    expect(h.calls().some((call) => call.url.pathname.endsWith("/permissions"))).toBe(false)
  })

  test("a move that is made again finds the item there and changes nothing more", async () => {
    const h = await writeFixture({ handlers: [itemHandler(FILE_ID, { parents: [ROOT_ID] }), moves] })
    await h.move.run({ file_id: FILE_ID, folder: "root" })
    expect((await h.move.run({ file_id: FILE_ID, folder: "root" })).moved).toBe(false)
  })

  test("reports the destination when Google's answer lacks the parents", async () => {
    const h = await writeFixture({ handlers: [itemHandler(FILE_ID), ...parent(), patchHandler(FILE_ID, { json: {} })] })
    expect(await h.move.run({ file_id: FILE_ID, folder: "root" })).toMatchObject({ folder_id: ROOT_ID, moved: true })
  })
})

describe("google_drive_move prompt", () => {
  test("headlines the item and the folder, shows where it comes from and its kind, and pins the folders", async () => {
    const h = await writeFixture({ handlers: [itemHandler(FILE_ID), ...parent()] })
    expect(await h.move.describe({ file_id: FILE_ID, folder: "root" })).toEqual({
      headline: { text: "About to move {name} to {folder}", values: { name: "Budget 2026.pdf", folder: "My Drive" } },
      facts: [
        { label: "From", value: "Projects" },
        { label: "Type", value: "file" },
      ],
      pins: { parents: expect.stringMatching(/^[0-9a-f]{64}$/), folder: ROOT_ID },
    })
  })

  test("an item already there says so in the headline, with no write", async () => {
    const h = await writeFixture({ handlers: [itemHandler(FILE_ID, { parents: [ROOT_ID] })] })
    const description = await h.move.describe({ file_id: FILE_ID, folder: "root" })
    expect(description.headline).toEqual({
      text: "{name} is already in {folder}",
      values: { name: "Budget 2026.pdf", folder: "My Drive" },
    })
    expect(description.facts[0]).toEqual({ label: "From", value: "My Drive" })
    expect(h.writes()).toEqual([])
  })

  test("pins one digest of every parent's id and sharing, which changes with either", async () => {
    const pinsOf = async (permission: Record<string, unknown>, parents = [FOLDER_ID]) => {
      const h = await writeFixture({
        handlers: [
          itemHandler(FILE_ID, { parents }),
          ownFolderHandlers(FOLDER_ID)[0]!,
          answer(permissionsUrl(FOLDER_ID), { permissions: [permission] }),
          ...parent(OTHER_FOLDER_ID),
        ],
      })
      return (await h.move.describe({ file_id: FILE_ID, folder: "root" })).pins
    }
    const owner = { id: "p1", type: "user", role: "owner", emailAddress: "someone@example.test" }
    const before = await pinsOf(owner)
    expect(await pinsOf(owner)).toEqual(before)
    expect(await pinsOf({ ...owner, id: "p9" })).not.toEqual(before)
    expect((await pinsOf(owner, [FOLDER_ID, OTHER_FOLDER_ID]))?.parents).not.toBe(before?.parents)
  })

  test("the targets are the item and the destination folder's real id", async () => {
    const h = await writeFixture({ handlers: [itemHandler(FILE_ID), ...parent(), ...parent(OTHER_FOLDER_ID)] })
    expect(await h.move.targets({ file_id: FILE_ID, folder: "root" })).toEqual([
      `work/files/${FILE_ID}`,
      `work/folders/${ROOT_ID}`,
    ])
    expect(await h.move.targets({ file_id: FILE_ID, folder: OTHER_FOLDER_ID })).toEqual([
      `work/files/${FILE_ID}`,
      `work/folders/${OTHER_FOLDER_ID}`,
    ])
    expect(await h.move.targets({ file_id: FILE_ID })).toEqual(["*"])
  })
})
