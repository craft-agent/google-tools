import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { link, mkdir, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { CREDENTIAL, toolError } from "../google/client.fixtures"
import { DRIVE_FILE_SCOPE, DRIVE_READ_SCOPE } from "./scopes"
import { MAX_UPLOAD_NAME_LENGTH } from "./upload-args"
import { cleanUp, freshTokens, removeUploads, uploadFixture } from "./upload.testing"

beforeEach(freshTokens)
afterEach(async () => {
  await cleanUp()
  await removeUploads()
})

const fixture = (options: Parameters<typeof uploadFixture>[0] = {}) =>
  uploadFixture({ files: { "report.txt": "quarterly figures" }, ...options })

describe("google_drive_upload upload directories", () => {
  test("with none set, nothing is read, and it is forbidden before any request", async () => {
    const h = await fixture({ uploadDirs: () => [] })
    const error = await toolError(h.upload({ path: join(h.uploadDir, "report.txt") }))
    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("upload_dirs")
    expect(h.calls()).toEqual([])
  })

  test("a file outside the upload directories is forbidden before any request", async () => {
    const h = await fixture()
    await writeFile(join(h.uploadDir, "..", "elsewhere.txt"), "x")
    expect((await toolError(h.upload({ path: join(h.uploadDir, "..", "elsewhere.txt") }))).code).toBe("forbidden")
    expect(h.calls()).toEqual([])
  })

  test("a file inside the state directory is forbidden even when an upload directory holds it", async () => {
    const h = await fixture({ uploadDirs: (_dir, stateDir) => [stateDir] })
    const error = await toolError(h.upload({ path: join(h.stateDir, "accounts", "work", "credentials.json") }))
    expect(error.code).toBe("forbidden")
    expect(h.calls()).toEqual([])
  })

  test("a relative path is invalid_argument, a missing file not_found", async () => {
    const h = await fixture()
    expect((await toolError(h.upload({ path: "report.txt" }))).code).toBe("invalid_argument")
    expect((await toolError(h.upload({ path: join(h.uploadDir, "missing.txt") }))).code).toBe("not_found")
    expect(h.calls()).toEqual([])
  })

  test("a link and a hard-linked file are forbidden, nothing sent", async () => {
    const h = await fixture()
    await writeFile(join(h.uploadDir, "..", "secret.txt"), "x")
    await symlink(join(h.uploadDir, "report.txt"), join(h.uploadDir, "alias.txt"))
    await link(join(h.uploadDir, "..", "secret.txt"), join(h.uploadDir, "twin.txt"))
    await mkdir(join(h.uploadDir, "folder"))
    for (const name of ["alias.txt", "twin.txt", "folder"]) {
      const error = await toolError(h.upload({ path: join(h.uploadDir, name) }))
      expect([name, error.code]).toEqual([name, "forbidden"])
    }
    expect(h.calls()).toEqual([])
  })
})

describe("google_drive_upload scopes", () => {
  const path = (h: { uploadDir: string }) => join(h.uploadDir, "report.txt")

  test("a label that only reads fails as unauthenticated, naming drive.file, before any request", async () => {
    const h = await fixture({ credential: { ...CREDENTIAL, scopes: [...CREDENTIAL.scopes, DRIVE_READ_SCOPE] } })
    const error = await toolError(h.upload({ path: path(h) }))
    expect(error.code).toBe("unauthenticated")
    expect(error.message).toContain(DRIVE_FILE_SCOPE)
    expect(h.calls()).toEqual([])
  })

  test("a label that only writes fails as unauthenticated, naming drive.readonly, before any request", async () => {
    const h = await fixture({ credential: { ...CREDENTIAL, scopes: [...CREDENTIAL.scopes, DRIVE_FILE_SCOPE] } })
    const error = await toolError(h.upload({ path: path(h) }))
    expect(error.code).toBe("unauthenticated")
    expect(error.message).toContain(DRIVE_READ_SCOPE)
    expect(h.calls()).toEqual([])
  })

  test("the same holds for the prompt: describing fails before any request", async () => {
    const h = await fixture({ credential: CREDENTIAL })
    expect((await toolError(h.describe({ path: path(h) }))).code).toBe("unauthenticated")
    expect(h.calls()).toEqual([])
  })
})

describe("google_drive_upload arguments", () => {
  const refused = async (extra: Record<string, unknown>) => {
    const h = await fixture()
    const error = await toolError(h.upload({ path: join(h.uploadDir, "report.txt"), ...extra }))
    expect(h.calls()).toEqual([])
    return error
  }

  test.each([
    ["a name with a control character", { name: "a\nb.txt" }],
    ["an empty name", { name: "" }],
    ["a name that is too long", { name: "n".repeat(MAX_UPLOAD_NAME_LENGTH + 1) }],
    ["a media type that is no type/subtype", { mime_type: "pdf" }],
    ["a media type with parameters", { mime_type: "text/plain; charset=utf-8" }],
    ["a media type with a line break", { mime_type: "text/plain\r\nX-Evil: 1" }],
    ["an unknown argument", { overwrite: true }],
    ["a credential-like argument", { access_token: "x" }],
  ])("%s is invalid_argument, before any request", async (_name, extra) => {
    expect((await refused(extra)).code).toBe("invalid_argument")
  })

  test("a name of exactly the longest length is accepted", async () => {
    const h = await fixture()
    const name = "n".repeat(MAX_UPLOAD_NAME_LENGTH)
    expect((await h.upload({ path: join(h.uploadDir, "report.txt"), name })).name).toBe(name)
  })

  test("a file whose own name holds a control character needs a name of its own", async () => {
    const h = await fixture({ files: { "bad\nname.txt": "x" } })
    const error = await toolError(h.upload({ path: join(h.uploadDir, "bad\nname.txt") }))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("`name`")
    expect(h.calls()).toEqual([])
    expect((await h.upload({ path: join(h.uploadDir, "bad\nname.txt"), name: "good.txt" })).name).toBe("good.txt")
  })
})
