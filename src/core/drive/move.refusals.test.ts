import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import type { FakeHandler, FakeReply } from "../google/fake-google.testing"
import {
  FILE_ID,
  FOLDER_ID,
  OTHER_FOLDER_ID,
  ROOT_ID,
  SHARED_DRIVE_ID,
  UPLOAD_CREDENTIAL,
  answer,
  cleanUp,
  fileUrl,
  folderHandler,
  freshTokens,
  itemHandler,
  ownFolderHandlers,
  patchHandler,
  permissionsUrl,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const SHARED_PARENT = "it would take it from the people there"

const grantsAnyone = answer(permissionsUrl(FOLDER_ID), {
  permissions: [
    { id: "p1", type: "user", role: "owner", emailAddress: "someone@example.test" },
    { id: "p2", type: "anyone", role: "reader" },
  ],
})

/** A fixture whose item is in `FOLDER_ID` as `handlers` show it and whose move to the top of My Drive Google takes. */
const fromFolder = (handlers: FakeHandler[], options: Parameters<typeof writeFixture>[0] = {}) =>
  writeFixture({ handlers: [itemHandler(FILE_ID), ...handlers, patchHandler(FILE_ID)], ...options })

/** Moves the item to the top of My Drive and returns the refusal, which came before any write. */
async function refused(h: Awaited<ReturnType<typeof fromFolder>>, folder = "root") {
  const error = await toolError(h.move.run({ file_id: FILE_ID, folder }))
  expect(h.writes()).toEqual([])
  return error
}

describe("google_drive_move takes nothing out of a shared place", () => {
  test("an item in a shared folder is refused: moving it would take it from the people there", async () => {
    const error = await refused(await fromFolder([ownFolderHandlers()[0]!, grantsAnyone]))
    expect(error.code).toBe("forbidden")
    expect(error.message).toContain(`in the shared folder ${FOLDER_ID}`)
    expect(error.message).toContain(SHARED_PARENT)
  })

  test("a parent whose sharing Google hides counts as shared", async () => {
    const hidden: FakeReply = {
      status: 403,
      json: { error: { code: 403, errors: [{ reason: "forbidden" }], status: "PERMISSION_DENIED" } },
    }
    const h = await fromFolder([
      ownFolderHandlers()[0]!,
      { method: "GET", url: permissionsUrl(FOLDER_ID), reply: hidden },
    ])
    expect((await refused(h)).message).toContain(SHARED_PARENT)
  })

  test("one shared parent among several refuses the move", async () => {
    const h = await writeFixture({
      handlers: [
        itemHandler(FILE_ID, { parents: [OTHER_FOLDER_ID, FOLDER_ID] }),
        ...ownFolderHandlers(OTHER_FOLDER_ID),
        ownFolderHandlers()[0]!,
        grantsAnyone,
      ],
    })
    expect((await refused(h)).code).toBe("forbidden")
  })

  test("an item in a shared drive is refused, without reading any folder's permissions", async () => {
    const h = await writeFixture({ handlers: [itemHandler(FILE_ID, { driveId: SHARED_DRIVE_ID })] })
    const error = await refused(h)
    expect(error.message).toContain("in a shared drive")
    expect(error.message).toContain(SHARED_PARENT)
    expect(h.calls().some((call) => call.url.pathname.endsWith("/permissions"))).toBe(false)
  })

  test("an item whose folders Google hides is refused, reading no folder", async () => {
    const h = await writeFixture({ handlers: [itemHandler(FILE_ID, { parents: [] })] })
    const error = await refused(h)
    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("a folder Google does not show this account")
    expect(h.calls().some((call) => call.url.pathname.endsWith("/permissions"))).toBe(false)
  })

  test("a parent the account cannot be told to own alone is refused when its address is not recorded", async () => {
    const h = await fromFolder(ownFolderHandlers(), { credential: { ...UPLOAD_CREDENTIAL, email: null } })
    const error = await refused(h)
    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("cannot be told")
  })
})

describe("google_drive_move puts nothing into a shared place", () => {
  test("a shared destination folder is refused with the upload's rule", async () => {
    const h = await writeFixture({
      handlers: [
        itemHandler(FILE_ID),
        ownFolderHandlers(OTHER_FOLDER_ID)[0]!,
        answer(permissionsUrl(OTHER_FOLDER_ID), {
          permissions: [{ id: "p2", type: "domain", role: "reader", domain: "example.test" }],
        }),
        patchHandler(FILE_ID),
      ],
    })
    const error = await toolError(h.move.run({ file_id: FILE_ID, folder: OTHER_FOLDER_ID }))
    expect(error.code).toBe("forbidden")
    expect(error.message).toContain(`The folder ${OTHER_FOLDER_ID} is shared (or in a shared drive)`)
    expect(h.writes()).toEqual([])
  })

  test("a destination in a shared drive, in the trash or that is no folder is refused", async () => {
    for (const extra of [{ driveId: SHARED_DRIVE_ID }, { trashed: true }, { mimeType: "application/pdf" }]) {
      const h = await writeFixture({ handlers: [itemHandler(FILE_ID), ...ownFolderHandlers(OTHER_FOLDER_ID, extra)] })
      expect((await toolError(h.move.run({ file_id: FILE_ID, folder: OTHER_FOLDER_ID }))).code).toBe("forbidden")
      expect(h.writes()).toEqual([])
    }
  })
})

describe("google_drive_move into itself", () => {
  const folderItem = (handlers: FakeHandler[] = []) =>
    writeFixture({ handlers: [folderHandler(FOLDER_ID, { parents: [ROOT_ID] }), ...handlers] })

  test("a folder moved into itself is invalid_argument, and nothing is sent", async () => {
    const h = await folderItem(ownFolderHandlers())
    const error = await toolError(h.move.run({ file_id: FOLDER_ID, folder: FOLDER_ID }))
    expect(error).toMatchObject({ code: "invalid_argument", message: expect.stringContaining("into itself") })
    expect(h.writes()).toEqual([])
  })

  test.each([
    [400, "Bad Request"],
    [400, "Cannot move a folder into one of its own subfolders."],
    [403, "A folder cannot be a descendant of itself."],
  ])("Google's %s for a folder put below itself is invalid_argument", async (status, message) => {
    const refusal: FakeReply = {
      status,
      json: { error: { code: status, message, errors: [{ reason: "badRequest" }] } },
    }
    const h = await folderItem([
      ...ownFolderHandlers(OTHER_FOLDER_ID, { parents: [] }),
      ...ownFolderHandlers(ROOT_ID, { name: "My Drive" }),
      patchHandler(FOLDER_ID, refusal),
    ])
    const error = await toolError(h.move.run({ file_id: FOLDER_ID, folder: OTHER_FOLDER_ID }))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe("A folder cannot be moved into itself or into a folder inside it.")
  })

  test("any other refusal of a folder move is told by its status as usual", async () => {
    const other: FakeReply = { status: 400, json: { error: { code: 400, message: "Bad request." } } }
    const h = await folderItem([
      ...ownFolderHandlers(OTHER_FOLDER_ID, { parents: [] }),
      ...ownFolderHandlers(ROOT_ID, { name: "My Drive" }),
      patchHandler(FOLDER_ID, other),
    ])
    expect((await toolError(h.move.run({ file_id: FOLDER_ID, folder: OTHER_FOLDER_ID }))).code).toBe("upstream_error")
  })

  test("the same words on a file are drive.file's refusal, not a loop", async () => {
    const refusal: FakeReply = { status: 403, json: { error: { code: 403, message: "Not itself allowed." } } }
    const h = await writeFixture({
      handlers: [
        itemHandler(FILE_ID, { parents: [ROOT_ID] }),
        ...ownFolderHandlers(),
        ...ownFolderHandlers(ROOT_ID),
        { method: "PATCH", url: fileUrl(FILE_ID), reply: refusal },
      ],
    })
    expect((await toolError(h.move.run({ file_id: FILE_ID, folder: FOLDER_ID }))).message).toContain("drive.file")
  })
})

describe("google_drive_move arguments", () => {
  test.each([
    ["no folder", { file_id: FILE_ID }],
    ["a folder that is not an id", { file_id: FILE_ID, folder: "a/b" }],
    ["root as the item", { file_id: "root", folder: FOLDER_ID }],
    ["an unknown argument", { file_id: FILE_ID, folder: "root", copy: true }],
  ])("%s is refused before any request", async (_what, args) => {
    const h = await fromFolder([])
    expect((await toolError(h.move.run(args))).code).toBe("invalid_argument")
    expect(h.calls()).toEqual([])
  })
})
