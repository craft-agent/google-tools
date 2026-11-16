import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { toolError } from "../google/client.fixtures"
import type { FakeHandler } from "../google/fake-google.testing"
import {
  FILES_URL,
  FOLDER_ID,
  OWNER,
  ROOT_ID,
  UPLOAD_CREDENTIAL,
  answer,
  cleanUp,
  fileUrl,
  freshTokens,
  ownFolderHandlers,
  permissionsUrl,
  removeUploads,
  uploadFixture,
} from "./upload.testing"

beforeEach(freshTokens)
afterEach(async () => {
  await cleanUp()
  await removeUploads()
})

const REFUSAL = "putting a file there shares it with everyone who reaches it, and these tools never change sharing."

/** A fixture whose folder is `FOLDER_ID` as `handlers` show it, holding `report.txt`. */
const intoFolder = (handlers: FakeHandler[], credential = UPLOAD_CREDENTIAL) =>
  uploadFixture({ handlers, credential, files: { "report.txt": "quarterly figures" } })

const permissionsOf = (...permissions: Record<string, unknown>[]) => answer(permissionsUrl(FOLDER_ID), { permissions })

const OWNER_PERMISSION = { id: "p1", type: "user", role: "owner", emailAddress: OWNER }

/** Uploads `report.txt` into the folder and returns the refusal. */
async function refused(h: Awaited<ReturnType<typeof intoFolder>>) {
  const error = await toolError(h.upload({ path: join(h.uploadDir, "report.txt"), folder: FOLDER_ID }))
  expect(h.uploads()).toEqual([])
  return error
}

describe("google_drive_upload destination: where a file may go", () => {
  test("My Drive needs only the id of its top folder, and reads no permissions", async () => {
    const h = await intoFolder([])
    await h.upload({ path: join(h.uploadDir, "report.txt") })
    const [root] = h.calls()
    expect(root?.url.pathname).toBe("/drive/v3/files/root")
    expect(Object.fromEntries(root!.url.searchParams)).toEqual({ supportsAllDrives: "true", fields: "id,name" })
    expect(h.calls().some((call) => call.url.pathname.endsWith("/permissions"))).toBe(false)
  })

  test("an own folder that no one else can reach is allowed, its owner's address compared in any case", async () => {
    const h = await intoFolder(ownFolderHandlers(FOLDER_ID, { owners: [{ emailAddress: OWNER.toUpperCase() }] }))
    const result = await h.upload({ path: join(h.uploadDir, "report.txt"), folder: FOLDER_ID })
    expect(result.folder_id).toBe(FOLDER_ID)
    const folder = h.calls().find((call) => call.url.pathname === `/drive/v3/files/${FOLDER_ID}`)
    expect(folder?.url.searchParams.get("fields")).toBe("id,name,mimeType,driveId,trashed,owners(emailAddress)")
  })

  test("a folder shared with a person is refused, naming the folder and why", async () => {
    const h = await intoFolder([
      ownFolderHandlers()[0]!,
      permissionsOf(OWNER_PERMISSION, { id: "p2", type: "user", role: "reader", emailAddress: "ann@example.test" }),
    ])
    const error = await refused(h)
    expect(error.code).toBe("forbidden")
    expect(error.message).toBe(`The folder ${FOLDER_ID} is shared (or in a shared drive); ${REFUSAL}`)
  })

  test.each([
    ["anyone with the link", { id: "p2", type: "anyone", role: "reader", allowFileDiscovery: false }],
    ["a domain", { id: "p2", type: "domain", role: "reader", domain: "example.test" }],
    ["a group", { id: "p2", type: "group", role: "writer", emailAddress: "team@example.test" }],
  ])("a folder open to %s is refused", async (_name, permission) => {
    const h = await intoFolder([ownFolderHandlers()[0]!, permissionsOf(OWNER_PERMISSION, permission)])
    expect((await refused(h)).code).toBe("forbidden")
  })

  test("sharing that shows only on a later page of permissions is found", async () => {
    const pages: FakeHandler = {
      method: "GET",
      url: permissionsUrl(FOLDER_ID),
      reply: (request) =>
        request.url.searchParams.get("pageToken") === null
          ? { json: { permissions: [OWNER_PERMISSION], nextPageToken: "page-2" } }
          : { json: { permissions: [{ id: "p2", type: "anyone", role: "reader" }] } },
    }
    const h = await intoFolder([ownFolderHandlers()[0]!, pages])
    expect((await refused(h)).message).toContain("is shared")
    expect(h.calls().filter((call) => call.url.pathname.endsWith("/permissions"))).toHaveLength(2)
  })

  test("a folder in a shared drive is refused without listing its permissions", async () => {
    const h = await intoFolder([...ownFolderHandlers(FOLDER_ID, { driveId: "0AMadeUpSharedDriveId_Uk9PVA" })])
    expect((await refused(h)).message).toContain("is shared (or in a shared drive)")
    expect(h.calls().some((call) => call.url.pathname.endsWith("/permissions"))).toBe(false)
  })

  test("a folder someone else owns is refused even when it is shared with the account alone", async () => {
    const h = await intoFolder(ownFolderHandlers(FOLDER_ID, { owners: [{ emailAddress: "ann@example.test" }] }))
    expect((await refused(h)).message).toContain("is shared (or in a shared drive)")
  })

  test("a folder in the trash is refused", async () => {
    const h = await intoFolder(ownFolderHandlers(FOLDER_ID, { trashed: true }))
    const error = await refused(h)
    expect(error).toMatchObject({ code: "forbidden", message: `The folder ${FOLDER_ID} is in the trash.` })
  })

  test("a file that is not a folder is refused", async () => {
    const h = await intoFolder(ownFolderHandlers(FOLDER_ID, { mimeType: "application/pdf" }))
    expect(await refused(h)).toMatchObject({ code: "forbidden", message: `${FOLDER_ID} is not a folder.` })
  })

  test("a folder whose permissions cannot be listed counts as shared", async () => {
    const h = await intoFolder([
      ownFolderHandlers()[0]!,
      {
        method: "GET",
        url: permissionsUrl(FOLDER_ID),
        reply: {
          status: 403,
          json: { error: { code: 403, errors: [{ reason: "forbidden" }], status: "PERMISSION_DENIED" } },
        },
      },
    ])
    expect((await refused(h)).message).toContain("is shared (or in a shared drive)")
  })

  test("a rate limit while listing the permissions fails as rate_limited, not as sharing", async () => {
    const h = await intoFolder([
      ownFolderHandlers()[0]!,
      {
        method: "GET",
        url: permissionsUrl(FOLDER_ID),
        reply: { status: 403, json: { error: { code: 403, errors: [{ reason: "rateLimitExceeded" }] } } },
      },
    ])
    expect((await refused(h)).code).toBe("rate_limited")
  })

  test("an account whose address is not recorded cannot be told to own the folder, and is refused", async () => {
    const h = await intoFolder(ownFolderHandlers(), { ...UPLOAD_CREDENTIAL, email: null })
    const error = await refused(h)
    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("cannot be told")
  })

  test("the top of My Drive needs no address", async () => {
    const h = await intoFolder([], { ...UPLOAD_CREDENTIAL, email: null })
    expect((await h.upload({ path: join(h.uploadDir, "report.txt") })).folder_id).toBe(ROOT_ID)
  })

  test("a folder that does not exist is not_found", async () => {
    const h = await intoFolder([
      {
        method: "GET",
        url: fileUrl(FOLDER_ID),
        reply: { status: 404, json: { error: { code: 404, status: "NOT_FOUND" } } },
      },
    ])
    expect((await refused(h)).code).toBe("not_found")
  })

  test("a folder that is not an id is invalid_argument, before any request", async () => {
    const h = await intoFolder([])
    const error = await toolError(h.upload({ path: join(h.uploadDir, "report.txt"), folder: "../elsewhere" }))
    expect(error.code).toBe("invalid_argument")
    expect(h.calls()).toEqual([])
  })

  test("the folder is told apart from the files already there by one list call", async () => {
    const h = await intoFolder(ownFolderHandlers())
    await h.upload({ path: join(h.uploadDir, "report.txt"), folder: FOLDER_ID })
    const lists = h
      .calls()
      .filter((call) => call.url.href.startsWith(FILES_URL) && call.url.pathname === "/drive/v3/files")
    expect(lists).toHaveLength(1)
  })
})
