import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import {
  FILE_ID,
  FOLDER_ID,
  OTHER_FOLDER_ID,
  ROOT_ID,
  cleanUp,
  fileUrl,
  folderHandler,
  freshTokens,
  itemHandler,
  ownFolderHandlers,
  patchHandler,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const GRANDCHILD_ID = "1MadeUpGrandchildFolder_0123"

describe("google_drive_move destination ancestors", () => {
  test("a folder moved into its grandchild is refused before any PATCH", async () => {
    const h = await writeFixture({
      handlers: [
        folderHandler(FOLDER_ID, { parents: [ROOT_ID] }),
        ...ownFolderHandlers(GRANDCHILD_ID, { parents: [OTHER_FOLDER_ID] }),
        folderHandler(OTHER_FOLDER_ID, { parents: [FOLDER_ID] }),
        patchHandler(FOLDER_ID),
      ],
    })
    const error = await toolError(h.move.run({ file_id: FOLDER_ID, folder: GRANDCHILD_ID }))
    expect(error).toMatchObject({
      code: "invalid_argument",
      message: "A folder cannot be moved into itself or into a folder inside it.",
    })
    expect(h.writes()).toEqual([])
  })

  test("a folder can move into an unrelated folder whose ancestry ends at My Drive", async () => {
    const h = await writeFixture({
      handlers: [
        folderHandler(FOLDER_ID, { parents: [ROOT_ID] }),
        ...ownFolderHandlers(OTHER_FOLDER_ID, { parents: [ROOT_ID] }),
        ...ownFolderHandlers(ROOT_ID, { parents: [] }),
        patchHandler(FOLDER_ID),
      ],
    })
    expect(await h.move.run({ file_id: FOLDER_ID, folder: OTHER_FOLDER_ID })).toMatchObject({ moved: true })
    expect(h.writes()).toHaveLength(1)
  })

  test("a file skips the destination's ancestor walk", async () => {
    const h = await writeFixture({
      handlers: [
        itemHandler(FILE_ID, { parents: [ROOT_ID] }),
        ...ownFolderHandlers(OTHER_FOLDER_ID, { parents: [GRANDCHILD_ID] }),
        ...ownFolderHandlers(ROOT_ID),
        patchHandler(FILE_ID),
      ],
    })
    expect(await h.move.run({ file_id: FILE_ID, folder: OTHER_FOLDER_ID })).toMatchObject({ moved: true })
    expect(h.calls().some((call) => call.url.pathname === new URL(fileUrl(GRANDCHILD_ID)).pathname)).toBe(false)
    expect(h.calls().filter((call) => call.url.pathname === new URL(fileUrl(OTHER_FOLDER_ID)).pathname)).toHaveLength(1)
  })

  test("an ancestor walk that cannot finish within the bound refuses without a write", async () => {
    const h = await writeFixture({
      handlers: [
        folderHandler(FOLDER_ID, { parents: [ROOT_ID] }),
        ...ownFolderHandlers(OTHER_FOLDER_ID, { parents: [OTHER_FOLDER_ID] }),
        patchHandler(FOLDER_ID),
      ],
    })
    const error = await toolError(h.move.run({ file_id: FOLDER_ID, folder: OTHER_FOLDER_ID }))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("destination's ancestors could not be followed")
    expect(h.writes()).toEqual([])
  })

  test("a bare 400 badRequest for a file is not mapped to a folder cycle", async () => {
    const h = await writeFixture({
      handlers: [
        itemHandler(FILE_ID, { parents: [ROOT_ID] }),
        ...ownFolderHandlers(OTHER_FOLDER_ID),
        ...ownFolderHandlers(ROOT_ID),
        patchHandler(FILE_ID, {
          status: 400,
          json: { error: { code: 400, message: "Bad Request", errors: [{ reason: "badRequest" }] } },
        }),
      ],
    })
    expect((await toolError(h.move.run({ file_id: FILE_ID, folder: OTHER_FOLDER_ID }))).code).toBe("upstream_error")
  })
})
