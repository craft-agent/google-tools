import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import type { FakeHandler } from "../google/fake-google.testing"
import {
  FILE_ID,
  GOOGLE_APPS,
  answer,
  cleanUp,
  driveFile,
  fileUrl,
  fixture,
  freshTokens,
  permissionsUrl,
  refusal,
  respond,
} from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const read = { method: "file", file_id: FILE_ID }

/** A fixture whose file is the one given and whose permissions are served by `handler`. */
const withPermissions = (handler: FakeHandler, file: Record<string, unknown> = driveFile(FILE_ID)) =>
  fixture([answer(fileUrl(FILE_ID), file), handler])

/** `count` made-up reader permissions, numbered from `from`. */
const readers = (count: number, from = 0) =>
  Array.from({ length: count }, (_, index) => ({
    id: `p${from + index}`,
    type: "user",
    role: "reader",
    emailAddress: `reader${from + index}@example.test`,
  }))

describe("google_drive_read file access", () => {
  test("describes every kind of permission", async () => {
    const h = await withPermissions(
      answer(permissionsUrl(FILE_ID), {
        permissions: [
          { id: "p1", type: "user", role: "writer", emailAddress: "ann@example.test", displayName: "Ann" },
          { id: "p2", type: "group", role: "reader", emailAddress: "team@example.test", displayName: "Team" },
          { id: "p3", type: "domain", role: "reader", domain: "example.test", allowFileDiscovery: true },
          { id: "p4", type: "anyone", role: "reader", allowFileDiscovery: false },
        ],
      }),
    )

    expect((await h.read(read)).access).toEqual([
      { type: "user", role: "writer", email: "ann@example.test", name: "Ann" },
      { type: "group", role: "reader", email: "team@example.test", name: "Team" },
      { type: "domain", role: "reader", domain: "example.test", discoverable: true },
      { type: "anyone", role: "reader", discoverable: false },
    ])
  })

  test("says whether a permission comes from a folder above", async () => {
    const h = await withPermissions(
      answer(permissionsUrl(FILE_ID), {
        permissions: [
          {
            id: "p1",
            type: "user",
            role: "writer",
            emailAddress: "ann@example.test",
            permissionDetails: [{ inherited: true, inheritedFrom: "folder-1", role: "writer" }],
          },
          {
            id: "p2",
            type: "user",
            role: "writer",
            emailAddress: "bo@example.test",
            permissionDetails: [
              { inherited: true, inheritedFrom: "folder-1", role: "reader" },
              { inherited: false, role: "writer" },
            ],
          },
        ],
      }),
    )

    expect((await h.read(read)).access).toEqual([
      { type: "user", role: "writer", email: "ann@example.test", inherited: true, inherited_from: "folder-1" },
      { type: "user", role: "writer", email: "bo@example.test", inherited: false },
    ])
  })

  test("pages through the permissions, 100 at a time", async () => {
    const h = await withPermissions({
      method: "GET",
      url: permissionsUrl(FILE_ID),
      reply: (request) =>
        request.url.searchParams.get("pageToken") === "page-2"
          ? { json: { permissions: readers(5, 100) } }
          : { json: { permissions: readers(100), nextPageToken: "page-2" } },
    })

    const result = await h.read(read)

    expect(result.access).toHaveLength(105)
    expect(result.access_note).toBeUndefined()
    expect(h.calls().filter((call) => call.url.pathname.endsWith("/permissions"))).toHaveLength(2)
  })

  test("stops at 10 pages and says the list is short", async () => {
    const h = await withPermissions({
      method: "GET",
      url: permissionsUrl(FILE_ID),
      reply: { json: { permissions: readers(100), nextPageToken: "more" } },
    })

    const result = await h.read(read)

    expect(result.access).toHaveLength(1000)
    expect(result.access_note).toBe("Only the first 1000 permissions are listed.")
    expect(h.calls().filter((call) => call.url.pathname.endsWith("/permissions"))).toHaveLength(10)
  })

  test("a file with no permission list has an empty access list", async () => {
    const h = await withPermissions(answer(permissionsUrl(FILE_ID), {}))

    expect((await h.read(read)).access).toEqual([])
  })
})

describe("google_drive_read file when Google hides the sharing", () => {
  const folder = driveFile(FILE_ID, { mimeType: `${GOOGLE_APPS}folder` })

  test.each([
    ["insufficientFilePermissions", "The user does not have sufficient permissions for this file."],
    ["forbidden", "The caller does not have permission"],
  ])("a 403 (%s) is no failure: access is null, with a note", async (reason, message) => {
    const h = await withPermissions(respond(permissionsUrl(FILE_ID), refusal(403, reason, message)))

    const result = await h.read(read)

    expect(result).toMatchObject({
      file_id: FILE_ID,
      access: null,
      access_note: "Google shows the sharing only to people who can share this file.",
    })
  })

  test("a folder whose sharing is hidden is reachable by others, since its owner would see it", async () => {
    const h = await withPermissions(
      respond(permissionsUrl(FILE_ID), refusal(403, "insufficientFilePermissions")),
      folder,
    )

    expect(await h.read(read)).toMatchObject({ access: null, reachable: "shared" })
  })

  test("a rate limit is still a failure", async () => {
    const h = await withPermissions(respond(permissionsUrl(FILE_ID), refusal(403, "userRateLimitExceeded")))

    expect(await toolError(h.read(read))).toMatchObject({ code: "rate_limited" })
  })

  test("other failures of the permission list pass through", async () => {
    const h = await withPermissions(respond(permissionsUrl(FILE_ID), refusal(500, "backendError")))

    expect(await toolError(h.read(read))).toMatchObject({ code: "upstream_error" })
  })
})
