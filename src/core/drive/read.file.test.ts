import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  FILE_ID,
  FOLDER_ID,
  GOOGLE_APPS,
  SHARED_DRIVE_ID,
  answer,
  callOf,
  cleanUp,
  driveFile,
  fileUrl,
  fixture,
  freshTokens,
  permissionsUrl,
} from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const OWNER_PERMISSION = { id: "p1", type: "user", role: "owner", emailAddress: "someone@example.test" }

/** A fixture that holds `file` with `permissions` (only its owner when none are given). */
const holding = (file: Record<string, unknown>, permissions: unknown[] = [OWNER_PERMISSION]) =>
  fixture([answer(fileUrl(FILE_ID), file), answer(permissionsUrl(FILE_ID), { permissions })])

describe("google_drive_read file", () => {
  test("returns the view with the description, the capabilities and who can reach the file", async () => {
    const h = await holding(
      driveFile(FILE_ID, {
        description: "The yearly plan.",
        md5Checksum: "d41d8cd98f00b204e9800998ecf8427e",
        capabilities: { canEdit: true, canShare: false, canTrash: true, canDownload: true },
      }),
    )

    const result = await h.read({ method: "file", file_id: FILE_ID })

    expect(result).toMatchObject({
      file_id: FILE_ID,
      name: "Budget 2026.pdf",
      kind: "file",
      size: 2048,
      md5: "d41d8cd98f00b204e9800998ecf8427e",
      description: "The yearly plan.",
      capabilities: { can_edit: true, can_share: false, can_trash: true, can_download: true },
      access: [{ type: "user", role: "owner", email: "someone@example.test" }],
    })
    expect(result.reachable).toBeUndefined()
    expect(result.access_note).toBeUndefined()
  })

  test("asks for the file's fields and its permissions across every drive", async () => {
    const h = await holding(driveFile(FILE_ID))

    await h.read({ method: "file", file_id: FILE_ID })

    expect(h.calls().map(callOf)).toEqual([`GET ${fileUrl(FILE_ID)}`, `GET ${permissionsUrl(FILE_ID)}`])
    const [get, list] = h.calls().map((call) => Object.fromEntries(call.url.searchParams))
    expect(get).toMatchObject({ supportsAllDrives: "true" })
    expect(get!.fields).toContain("description,capabilities(canEdit,canShare,canTrash,canDownload)")
    expect(list).toMatchObject({ supportsAllDrives: "true", pageSize: "100" })
    expect(list!.fields).toContain("permissionDetails(inherited,inheritedFrom,role)")
  })

  test.each([
    ["a folder", `${GOOGLE_APPS}folder`, "folder"],
    ["a Doc", `${GOOGLE_APPS}document`, "google_doc"],
    ["a Sheet", `${GOOGLE_APPS}spreadsheet`, "google_sheet"],
    ["a Slides file", `${GOOGLE_APPS}presentation`, "google_slides"],
    ["a Drawing", `${GOOGLE_APPS}drawing`, "google_drawing"],
    ["a Form", `${GOOGLE_APPS}form`, "google_other"],
    ["a shortcut", `${GOOGLE_APPS}shortcut`, "shortcut"],
    ["a PDF", "application/pdf", "file"],
    ["a file with no type", "", "file"],
  ])("%s has the kind %s", async (_name, mimeType, kind) => {
    const h = await holding(driveFile(FILE_ID, { mimeType }))

    expect(await h.read({ method: "file", file_id: FILE_ID })).toMatchObject({ kind, mime_type: mimeType })
  })

  test("a file of the Google editors has no size, even when Drive gives one", async () => {
    const h = await holding(driveFile(FILE_ID, { mimeType: `${GOOGLE_APPS}document`, size: "10" }))

    expect(await h.read({ method: "file", file_id: FILE_ID })).not.toHaveProperty("size")
  })

  test("a shortcut says what it points to", async () => {
    const h = await holding(
      driveFile(FILE_ID, {
        mimeType: `${GOOGLE_APPS}shortcut`,
        shortcutDetails: { targetId: FOLDER_ID, targetMimeType: `${GOOGLE_APPS}folder` },
      }),
    )

    expect(await h.read({ method: "file", file_id: FILE_ID })).toMatchObject({
      shortcut_target: { file_id: FOLDER_ID, mime_type: `${GOOGLE_APPS}folder` },
    })
  })

  test("a file in a shared drive carries the drive's id, several owners are all listed, and gaps are filled", async () => {
    const h = await holding({
      id: FILE_ID,
      driveId: SHARED_DRIVE_ID,
      owners: [{ emailAddress: "a@example.test" }, {}, { emailAddress: "b@example.test" }],
      shared: true,
      starred: true,
    })

    expect(await h.read({ method: "file", file_id: FILE_ID })).toMatchObject({
      name: "",
      mime_type: "",
      kind: "file",
      drive_id: SHARED_DRIVE_ID,
      owners: ["a@example.test", "b@example.test"],
      shared: true,
      starred: true,
      trashed: false,
      parents: [],
      modified_time: null,
      created_time: null,
      web_view_link: null,
      description: null,
    })
  })
})

describe("google_drive_read file reachability", () => {
  const folder = (extra: Record<string, unknown> = {}) =>
    driveFile(FILE_ID, { mimeType: `${GOOGLE_APPS}folder`, name: "Projects", ...extra })

  test("a folder only its owner can reach is only_you", async () => {
    const h = await holding(folder())

    expect(await h.read({ method: "file", file_id: FILE_ID })).toMatchObject({ reachable: "only_you" })
  })

  test.each([
    ["a person", { id: "p2", type: "user", role: "reader", emailAddress: "ann@example.test" }],
    ["a group", { id: "p2", type: "group", role: "reader", emailAddress: "team@example.test" }],
    ["anyone with the link", { id: "p2", type: "anyone", role: "reader", allowFileDiscovery: false }],
  ])("a folder shared with %s is shared", async (_name, permission) => {
    const h = await holding(folder(), [OWNER_PERMISSION, permission])

    expect(await h.read({ method: "file", file_id: FILE_ID })).toMatchObject({ reachable: "shared" })
  })

  test("a folder in a shared drive is shared whatever its permissions", async () => {
    const h = await holding(folder({ driveId: SHARED_DRIVE_ID }))

    expect(await h.read({ method: "file", file_id: FILE_ID })).toMatchObject({ reachable: "shared" })
  })

  test("only a folder says how reachable it is", async () => {
    const h = await holding(driveFile(FILE_ID), [OWNER_PERMISSION, { id: "p2", type: "anyone", role: "reader" }])

    expect(await h.read({ method: "file", file_id: FILE_ID })).not.toHaveProperty("reachable")
  })
})
