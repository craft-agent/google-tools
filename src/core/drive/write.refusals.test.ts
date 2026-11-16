import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { CREDENTIAL, toolError } from "../google/client.fixtures"
import { ToolError } from "../errors"
import { DRIVE_FILE_SCOPE, DRIVE_READ_SCOPE } from "./scopes"
import { driveRefusal } from "./write-session"
import {
  FILE_ID,
  FILES_URL,
  FOLDER_ID,
  ROOT_ID,
  cleanUp,
  fileUrl,
  freshTokens,
  itemHandler,
  itemsHandler,
  ownFolderHandlers,
  patchHandler,
  refused,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const WRITE_CALLS = {
  google_drive_folder_create: (h: Awaited<ReturnType<typeof writeFixture>>) => h.folderCreate.run({ name: "R" }),
  google_drive_copy: (h: Awaited<ReturnType<typeof writeFixture>>) => h.copy.run({ file_id: FILE_ID }),
  google_drive_rename: (h: Awaited<ReturnType<typeof writeFixture>>) => h.rename.run({ file_id: FILE_ID, name: "x" }),
  google_drive_move: (h: Awaited<ReturnType<typeof writeFixture>>) => h.move.run({ file_id: FILE_ID, folder: "root" }),
  google_drive_trash: (h: Awaited<ReturnType<typeof writeFixture>>) => h.trash.run({ file_ids: [FILE_ID] }),
  google_drive_restore: (h: Awaited<ReturnType<typeof writeFixture>>) => h.restore.run({ file_ids: [FILE_ID] }),
} as const

const readOnly = { ...CREDENTIAL, scopes: [...CREDENTIAL.scopes, DRIVE_READ_SCOPE] }
const writeOnly = { ...CREDENTIAL, scopes: [...CREDENTIAL.scopes, DRIVE_FILE_SCOPE] }

describe("the Drive write tools need both drive.file and drive.readonly, before any request", () => {
  test.each(Object.entries(WRITE_CALLS))("%s with a label that cannot write", async (_id, call) => {
    const h = await writeFixture({ credential: readOnly })
    const error = await toolError(call(h))
    expect(error.code).toBe("unauthenticated")
    expect(error.message).toContain(DRIVE_FILE_SCOPE)
    expect(h.calls()).toEqual([])
  })

  test.each(Object.entries(WRITE_CALLS))("%s with a label that cannot read", async (_id, call) => {
    const h = await writeFixture({ credential: writeOnly })
    const error = await toolError(call(h))
    expect(error.code).toBe("unauthenticated")
    expect(error.message).toContain(DRIVE_READ_SCOPE)
    expect(h.calls()).toEqual([])
  })

  test.each(Object.entries(WRITE_CALLS))("%s with no label at all", async (_id, call) => {
    const h = await writeFixture({ credential: null })
    expect((await toolError(call(h))).code).not.toBe("internal_error")
    expect(h.calls()).toEqual([])
  })
})

describe("what drive.file lets these tools change", () => {
  const item = itemHandler(FILE_ID, { parents: [ROOT_ID] })

  test.each([403, 404] as const)(
    "a %d on the write is forbidden, naming drive.file and that nothing was changed",
    async (status) => {
      const handlers = [
        itemHandler(FILE_ID),
        ...ownFolderHandlers(),
        itemsHandler(),
        { method: "POST" as const, url: FILES_URL, reply: refused(status) },
        { method: "POST" as const, url: `${fileUrl(FILE_ID)}/copy`, reply: refused(status) },
        patchHandler(FILE_ID, refused(status)),
      ]
      const h = await writeFixture({ handlers })
      const { google_drive_restore: _restore, ...changing } = WRITE_CALLS
      for (const call of Object.values(changing)) {
        const error = await toolError(call(h))
        expect(error.code).toBe("forbidden")
        expect(error.message).toContain("can change only the files and folders they created (drive.file)")
        expect(error.message).toContain("nothing was changed")
      }
    },
  )

  test("a 404 on the read is still not_found: the item could not be seen at all", async () => {
    const h = await writeFixture({
      handlers: [
        { method: "GET", url: fileUrl(FILE_ID), reply: { status: 404, json: { error: { status: "NOT_FOUND" } } } },
      ],
    })
    expect((await toolError(h.rename.run({ file_id: FILE_ID, name: "x" }))).code).toBe("not_found")
  })

  test("a rate limit and a server failure on the write keep their own codes", async () => {
    const limited = { status: 403, json: { error: { code: 403, errors: [{ reason: "userRateLimitExceeded" }] } } }
    const broken = { status: 500, json: { error: { code: 500, message: "Backend error." } } }
    const rate = await writeFixture({ handlers: [item, patchHandler(FILE_ID, limited)] })
    expect((await toolError(rate.rename.run({ file_id: FILE_ID, name: "x" }))).code).toBe("rate_limited")
    const server = await writeFixture({ handlers: [item, patchHandler(FILE_ID, broken)] })
    expect((await toolError(server.rename.run({ file_id: FILE_ID, name: "x" }))).code).toBe("upstream_error")
  })

  test("driveRefusal tells only a 403 or a 404 of Google, and keeps the cause", () => {
    const google = (status: number, code: ToolError["code"] = "upstream_error") =>
      new ToolError(code, "x", { details: { status } })
    expect(driveRefusal(google(403, "forbidden"))?.code).toBe("forbidden")
    expect(driveRefusal(google(404, "not_found"))?.cause).toBeInstanceOf(ToolError)
    expect(driveRefusal(google(403, "rate_limited"))).toBeUndefined()
    expect(driveRefusal(google(400))).toBeUndefined()
    expect(driveRefusal(google(500))).toBeUndefined()
    expect(driveRefusal(new Error("boom"))).toBeUndefined()
    expect(driveRefusal(new ToolError("forbidden", "no details"))).toBeUndefined()
    expect(driveRefusal(google(403, "forbidden"), "this one was not changed")?.message).toEndWith(
      "this one was not changed.",
    )
  })
})

describe("the destination rules are the upload's, for every tool that puts something in a folder", () => {
  test("a shared folder is refused by the folder creation, the copy and the move", async () => {
    const shared = [
      ownFolderHandlers()[0]!,
      {
        method: "GET" as const,
        url: `${fileUrl(FOLDER_ID)}/permissions`,
        reply: { json: { permissions: [{ id: "p2", type: "anyone", role: "reader" }] } },
      },
    ]
    const h = await writeFixture({ handlers: [itemHandler(FILE_ID), ...shared, patchHandler(FILE_ID)] })
    for (const call of [
      () => h.folderCreate.run({ name: "R", folder: FOLDER_ID }),
      () => h.copy.run({ file_id: FILE_ID, folder: FOLDER_ID }),
      () => h.move.run({ file_id: FILE_ID, folder: FOLDER_ID }),
    ]) {
      const error = await toolError(call())
      expect(error.code).toBe("forbidden")
      expect(error.message).toContain("is shared (or in a shared drive)")
    }
    expect(h.writes()).toEqual([])
  })
})
