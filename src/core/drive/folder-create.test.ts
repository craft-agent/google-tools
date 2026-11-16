import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import type { FakeHandler } from "../google/fake-google.testing"
import {
  FILES_URL,
  FOLDER_ID,
  NEW_FILE_ID,
  OWNER,
  ROOT_ID,
  UPLOAD_CREDENTIAL,
  answer,
  callOf,
  cleanUp,
  freshTokens,
  ownFolderHandlers,
  permissionsUrl,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const LINK = `https://drive.google.com/drive/folders/${NEW_FILE_ID}`

/** The handler that takes the creation and answers with the folder, in the folder `parent`. */
const creates = (parent = ROOT_ID): FakeHandler => ({
  method: "POST",
  url: FILES_URL,
  reply: (request) => ({
    json: { id: NEW_FILE_ID, name: (request.json as { name: string }).name, parents: [parent], webViewLink: LINK },
  }),
})

const sharedFolder = [
  ownFolderHandlers()[0]!,
  answer(permissionsUrl(FOLDER_ID), { permissions: [{ id: "p2", type: "anyone", role: "reader" }] }),
]

describe("google_drive_folder_create requests", () => {
  test("makes the folder in My Drive with one POST, naming its parent by the id of the top folder", async () => {
    const h = await writeFixture({ handlers: [creates()] })
    const result = await h.folderCreate.run({ name: "Reports" })
    expect(result).toEqual({ folder_id: NEW_FILE_ID, name: "Reports", parent_id: ROOT_ID, web_view_link: LINK })

    const [write] = h.writes()
    expect(callOf(write!)).toBe(`POST ${FILES_URL}`)
    expect(Object.fromEntries(write!.url.searchParams)).toEqual({
      supportsAllDrives: "true",
      fields: "id,name,parents,webViewLink",
    })
    expect(write!.json).toEqual({
      name: "Reports",
      mimeType: "application/vnd.google-apps.folder",
      parents: [ROOT_ID],
    })
  })

  test("makes it in an own, unshared folder, by its id", async () => {
    const h = await writeFixture({ handlers: [...ownFolderHandlers(), creates(FOLDER_ID)] })
    const result = await h.folderCreate.run({ name: "2026", folder: FOLDER_ID })
    expect(result.parent_id).toBe(FOLDER_ID)
    expect(h.writes()[0]!.json).toMatchObject({ parents: [FOLDER_ID] })
  })

  test("a folder of the same name is not replaced: creating again sends another request", async () => {
    const h = await writeFixture({ handlers: [creates()] })
    await h.folderCreate.run({ name: "Reports" })
    await h.folderCreate.run({ name: "Reports" })
    expect(h.writes()).toHaveLength(2)
  })

  test("a created folder is reported with what the plan knows when Google's answer lacks fields", async () => {
    const h = await writeFixture({ handlers: [{ method: "POST", url: FILES_URL, reply: { json: {} } }] })
    expect(await h.folderCreate.run({ name: "Reports" })).toEqual({
      folder_id: "",
      name: "Reports",
      parent_id: ROOT_ID,
      web_view_link: null,
    })
  })
})

describe("google_drive_folder_create destination", () => {
  test("a shared folder is refused with the upload's rule, and nothing is created", async () => {
    const h = await writeFixture({ handlers: [...sharedFolder, creates()] })
    const error = await toolError(h.folderCreate.run({ name: "Reports", folder: FOLDER_ID }))
    expect(error.code).toBe("forbidden")
    expect(error.message).toContain(`The folder ${FOLDER_ID} is shared (or in a shared drive)`)
    expect(h.writes()).toEqual([])
  })

  test("a folder in a shared drive or in the trash is refused", async () => {
    const shared = await writeFixture({
      handlers: [...ownFolderHandlers(FOLDER_ID, { driveId: "0Adrive" }), creates()],
    })
    expect((await toolError(shared.folderCreate.run({ name: "R", folder: FOLDER_ID }))).code).toBe("forbidden")
    const trashed = await writeFixture({ handlers: [...ownFolderHandlers(FOLDER_ID, { trashed: true }), creates()] })
    const error = await toolError(trashed.folderCreate.run({ name: "R", folder: FOLDER_ID }))
    expect(error.message).toBe(`The folder ${FOLDER_ID} is in the trash.`)
    expect(shared.writes().concat(trashed.writes())).toEqual([])
  })

  test("an account whose address is not recorded cannot create in a folder, but can in My Drive", async () => {
    const credential = { ...UPLOAD_CREDENTIAL, email: null }
    const own = await writeFixture({ handlers: [...ownFolderHandlers(), creates()], credential })
    expect((await toolError(own.folderCreate.run({ name: "R", folder: FOLDER_ID }))).message).toContain(
      "cannot be told",
    )
    const top = await writeFixture({ handlers: [creates()], credential })
    expect((await top.folderCreate.run({ name: "R" })).folder_id).toBe(NEW_FILE_ID)
  })
})

describe("google_drive_folder_create arguments", () => {
  test.each([
    ["an empty name", { name: "" }],
    ["a name over 500 characters", { name: "x".repeat(501) }],
    ["a name with a control character", { name: "a\nb" }],
    ["a folder that is not an id", { name: "R", folder: "../elsewhere" }],
    ["an unknown argument", { name: "R", sharing: "anyone" }],
  ])("%s is refused before any request", async (_what, args) => {
    const h = await writeFixture({ handlers: [creates()] })
    expect((await toolError(h.folderCreate.run(args))).code).toBe("invalid_argument")
    expect(h.calls()).toEqual([])
  })

  test("a name of 500 characters is accepted", async () => {
    const h = await writeFixture({ handlers: [creates()] })
    expect((await h.folderCreate.run({ name: "x".repeat(500) })).name).toHaveLength(500)
  })
})

describe("google_drive_folder_create prompt", () => {
  test("headlines the name and the folder as Google reports it, and shows no fact when the name is free", async () => {
    const top = await writeFixture()
    expect(await top.folderCreate.describe({ name: "Reports" })).toEqual({
      headline: {
        text: "About to create the folder {name} in {folder}",
        values: { name: "Reports", folder: "My Drive" },
      },
      facts: [],
      pins: { folder: ROOT_ID },
    })
    const own = await writeFixture({ handlers: ownFolderHandlers() })
    const description = await own.folderCreate.describe({ name: "Reports", folder: FOLDER_ID })
    expect(description.headline?.values).toEqual({ name: "Reports", folder: "Projects" })
    expect(description.pins?.folder).toMatch(/^[0-9a-f]{64}$/)
  })

  test("says how many files of the name are there already, asking for them by the name in the folder", async () => {
    const h = await writeFixture({ handlers: [answer(FILES_URL, { files: [{ id: "a" }, { id: "b" }] })] })
    expect((await h.folderCreate.describe({ name: "it's" })).facts).toEqual([
      { label: "Already there", value: { text: "{count} files named so", values: { count: 2 } } },
    ])
    const list = h.calls().find((call) => call.url.pathname === "/drive/v3/files")!
    expect(list.url.searchParams.get("q")).toBe(`name = 'it\\'s' and '${ROOT_ID}' in parents and trashed = false`)
  })

  test("the pin of an own folder changes with its permissions", async () => {
    const pinFor = async (role: string) => {
      const h = await writeFixture({
        handlers: [
          ownFolderHandlers()[0]!,
          answer(permissionsUrl(FOLDER_ID), { permissions: [{ id: "p1", type: "user", role, emailAddress: OWNER }] }),
        ],
      })
      return (await h.folderCreate.describe({ name: "R", folder: FOLDER_ID })).pins?.folder
    }
    expect(await pinFor("owner")).not.toBe(await pinFor("writer"))
  })

  test("the target is the label and the destination's real id; any target when the plan fails", async () => {
    const h = await writeFixture()
    expect(await h.folderCreate.targets({ name: "R" })).toEqual([`work/folders/${ROOT_ID}`])
    expect(await h.folderCreate.targets({ name: "R", folder: "../x" })).toEqual(["*"])
    expect(await (await writeFixture({ credential: null })).folderCreate.targets({ name: "R" })).toEqual(["*"])
  })
})
