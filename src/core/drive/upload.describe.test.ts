import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { join } from "node:path"
import { wholeCallDescription } from "../describe"
import { toolError } from "../google/client.fixtures"
import {
  FILES_URL,
  FOLDER_ID,
  OWNER,
  ROOT_ID,
  answer,
  cleanUp,
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

const CONTENT = "quarterly figures"
const SHA256 = createHash("sha256").update(CONTENT).digest("hex")

const OWNER_PERMISSION = { id: "p1", type: "user", role: "owner", emailAddress: OWNER }

const fixture = (options: Parameters<typeof uploadFixture>[0] = {}) =>
  uploadFixture({ files: { "report.txt": CONTENT }, ...options })

const argsOf = (h: Awaited<ReturnType<typeof fixture>>, extra: Record<string, unknown> = {}) => ({
  path: join(h.uploadDir, "report.txt"),
  ...extra,
})

describe("google_drive_upload describe", () => {
  test("shows the name and folder in the headline, then where the file comes from, its size and type", async () => {
    const h = await fixture()
    const description = await h.describe(argsOf(h))

    expect(description.headline).toEqual({
      text: "About to upload {name} to {folder}",
      values: { name: "report.txt", folder: "My Drive" },
    })
    expect(description.facts).toEqual([
      { label: "From", value: join(h.uploadDir, "report.txt") },
      { label: "Size", value: { text: "{bytes} bytes", values: { bytes: 17 } } },
      { label: "Type", value: "text/plain" },
    ])
    expect(description.text).toBeUndefined()
  })

  test("names the folder as Google reports it, and the name the file will get", async () => {
    const h = await fixture({ handlers: ownFolderHandlers() })
    const description = await h.describe(argsOf(h, { folder: FOLDER_ID, name: "Q3" }))
    expect(description.headline?.values).toEqual({ name: "Q3", folder: "Projects" })
  })

  test("pins the content's SHA-256 and, for My Drive, the id of its top folder", async () => {
    const h = await fixture()
    expect((await h.describe(argsOf(h))).pins).toEqual({ content: SHA256, folder: ROOT_ID })
  })

  test("pins a folder by a digest that changes with its permissions, and is the same for the same state", async () => {
    const pinFor = async (permission: Record<string, unknown>) => {
      const h = await fixture({
        handlers: [ownFolderHandlers()[0]!, answer(permissionsUrl(FOLDER_ID), { permissions: [permission] })],
      })
      return (await h.describe(argsOf(h, { folder: FOLDER_ID }))).pins?.folder
    }
    const first = await pinFor(OWNER_PERMISSION)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(await pinFor(OWNER_PERMISSION)).toBe(first)
    expect(await pinFor({ ...OWNER_PERMISSION, id: "p9" })).not.toBe(first)
    expect(await pinFor({ ...OWNER_PERMISSION, role: "writer" })).not.toBe(first)
  })

  test("a changed file gives another content pin", async () => {
    const h = await fixture({ files: { "report.txt": CONTENT, "other.txt": "quarterly figurez" } })
    const pinOf = async (name: string) => (await h.describe({ path: join(h.uploadDir, name) })).pins?.content
    expect(await pinOf("other.txt")).not.toBe(await pinOf("report.txt"))
  })

  test("is a description the prompt can use: well formed, with its pins", async () => {
    const h = await fixture()
    const whole = await wholeCallDescription(h.tool, argsOf(h), h.ctx)
    expect(whole?.pins).toEqual({ content: SHA256, folder: ROOT_ID })
    expect(whole?.facts).toHaveLength(3)
  })

  test("a destination that is refused fails the description with its own message", async () => {
    const h = await fixture({
      handlers: [
        ownFolderHandlers()[0]!,
        answer(permissionsUrl(FOLDER_ID), { permissions: [{ id: "p2", type: "anyone", role: "reader" }] }),
      ],
    })
    expect((await toolError(h.describe(argsOf(h, { folder: FOLDER_ID })))).code).toBe("forbidden")
  })
})

describe("google_drive_upload files already there", () => {
  test("says how many files of the name the folder holds, and that the upload adds another", async () => {
    const h = await fixture({ handlers: [answer(FILES_URL, { files: [{ id: "a" }, { id: "b" }] })] })
    const description = await h.describe(argsOf(h))
    expect(description.facts[3]).toEqual({
      label: "Already there",
      value: { text: "{count} files named so", values: { count: 2 } },
    })
    expect(description.facts).toHaveLength(4)
  })

  test("one file is said in the singular", async () => {
    const h = await fixture({ handlers: [answer(FILES_URL, { files: [{ id: "a" }] })] })
    expect((await h.describe(argsOf(h))).facts[3]).toEqual({
      label: "Already there",
      value: { text: "{count} file named so", values: { count: 1 } },
    })
  })

  test("asks for the files of that name in the folder, outside the trash, escaping the name", async () => {
    const h = await fixture({ files: { "it's.txt": "x" } })
    await h.describe({ path: join(h.uploadDir, "it's.txt") })
    const list = h.calls().find((call) => call.url.pathname === "/drive/v3/files")!
    expect(Object.fromEntries(list.url.searchParams)).toEqual({
      supportsAllDrives: "true",
      q: `name = 'it\\'s.txt' and '${ROOT_ID}' in parents and trashed = false`,
      pageSize: "10",
      fields: "files(id)",
    })
  })

  test("looks for the name the file will get, not its own", async () => {
    const h = await fixture()
    await h.describe(argsOf(h, { name: "Q3 report" }))
    const list = h.calls().find((call) => call.url.pathname === "/drive/v3/files")!
    expect(list.url.searchParams.get("q")).toContain("name = 'Q3 report'")
  })
})

describe("google_drive_upload targets and measure", () => {
  test("the target is the label and the folder's real id, the top folder's id for My Drive", async () => {
    const h = await fixture()
    expect(await h.targets(argsOf(h))).toEqual([`work/folders/${ROOT_ID}`])
    expect(await h.targets(argsOf(h, { folder: "root" }))).toEqual([`work/folders/${ROOT_ID}`])
  })

  test("the target of an own folder is its id", async () => {
    const h = await fixture({ handlers: ownFolderHandlers() })
    expect(await h.targets(argsOf(h, { folder: FOLDER_ID }))).toEqual([`work/folders/${FOLDER_ID}`])
  })

  test("any target when the plan fails: a refused folder, a missing file or no account", async () => {
    const shared = await fixture({
      handlers: [
        ownFolderHandlers()[0]!,
        answer(permissionsUrl(FOLDER_ID), { permissions: [{ id: "p2", type: "anyone", role: "reader" }] }),
      ],
    })
    expect(await shared.targets(argsOf(shared, { folder: FOLDER_ID }))).toEqual(["*"])
    expect(await shared.targets({ path: join(shared.uploadDir, "missing.txt") })).toEqual(["*"])
    const noAccount = await fixture({ credential: null })
    expect(await noAccount.targets(argsOf(noAccount))).toEqual(["*"])
  })

  test("the bounds are the most bytes, measured from the file's size", async () => {
    const h = await fixture()
    expect(h.tool.bounds).toEqual({ bytes: { kind: "max", description: expect.any(String) } })
    expect(await h.measure(argsOf(h))).toEqual({ bytes: 17 })
  })
})
