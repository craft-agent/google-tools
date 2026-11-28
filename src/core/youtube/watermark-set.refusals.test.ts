import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, symlink, truncate, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { toolError } from "../google/client.fixtures"
import { JPEG_BYTES, PNG_BYTES } from "./thumbnail.testing"
import { TEN_MB } from "./watermark.testing"
import {
  CHANNELS_URL,
  READ_ONLY_CREDENTIAL,
  cleanUp,
  freshTokens,
  refusal,
  respond,
  watermarkSetHandler,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

/** A fixture with `secret` in its upload directory named by `encrypt_dirs`. */
const withSecretDir = () => writeFixture({ settings: (uploadDir) => ({ encrypt_dirs: [join(uploadDir, "secret")] }) })

describe("google_youtube_watermark_set: a file that cannot be sent", () => {
  test("is forbidden when no upload directory is set", async () => {
    const h = await writeFixture({ files: { "mark.jpg": JPEG_BYTES }, uploadDirs: () => [] })

    const error = await toolError(h.watermarkSet.run({ path: join(h.uploadDir, "mark.jpg") }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("No upload directory is set")
    expect(h.writes()).toEqual([])
  })

  test("is forbidden outside the upload directories", async () => {
    const h = await writeFixture({
      files: { "mark.jpg": JPEG_BYTES },
      uploadDirs: (uploadDir) => [join(uploadDir, "elsewhere")],
    })

    const error = await toolError(h.watermarkSet.run({ path: join(h.uploadDir, "mark.jpg") }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("upload_dirs")
    expect(h.writes()).toEqual([])
  })

  test("is forbidden under encrypt_dirs, saying why, and nothing is sent", async () => {
    const h = await withSecretDir()
    await mkdir(join(h.uploadDir, "secret"))
    await writeFile(join(h.uploadDir, "secret", "mark.jpg"), JPEG_BYTES)

    const error = await toolError(h.watermarkSet.run({ path: join(h.uploadDir, "secret", "mark.jpg") }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("only ciphertext")
    expect(h.writes()).toEqual([])
    expect(h.lines().filter((line) => line.startsWith("GET"))).toEqual([])
  })

  test("is forbidden through a link into encrypt_dirs", async () => {
    const h = await withSecretDir()
    await mkdir(join(h.uploadDir, "secret"))
    await writeFile(join(h.uploadDir, "secret", "mark.jpg"), JPEG_BYTES)
    await symlink(join(h.uploadDir, "secret"), join(h.uploadDir, "link"))

    const error = await toolError(h.watermarkSet.run({ path: join(h.uploadDir, "link", "mark.jpg") }))

    expect(error.code).toBe("forbidden")
    expect(h.writes()).toEqual([])
  })

  test("a relative path is invalid_argument before any request", async () => {
    const h = await writeFixture()

    const error = await toolError(h.watermarkSet.run({ path: "mark.jpg" }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("absolute")
    expect(h.requests).toEqual([])
  })

  test.each([
    ["a file of another extension", "mark.gif", JPEG_BYTES, ".jpg, .jpeg or .png"],
    ["a file with no extension", "mark", JPEG_BYTES, ".jpg, .jpeg or .png"],
    ["a .jpg that holds a PNG", "mark.jpg", PNG_BYTES, "not one"],
    ["a .png that holds a JPEG", "mark.png", JPEG_BYTES, "not one"],
    ["a .jpeg that holds text", "mark.jpeg", "not an image", "not one"],
    ["an empty .png", "mark.png", "", "not one"],
  ])("refuses %s as invalid_argument, sending nothing", async (_name, file, content, hint) => {
    const h = await writeFixture({ files: { [file]: content } })

    const error = await toolError(h.watermarkSet.run({ path: join(h.uploadDir, file) }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(hint)
    expect(error.message).not.toContain("thumbnail")
    expect(h.writes()).toEqual([])
  })

  test("names a watermark, not a thumbnail, when the extension is wrong", async () => {
    const h = await writeFixture({ files: { "mark.gif": JPEG_BYTES } })

    const error = await toolError(h.watermarkSet.run({ path: join(h.uploadDir, "mark.gif") }))

    expect(error.message).toContain("a watermark is a JPEG or a PNG")
  })

  test("refuses a file over 10 MB, and sends one of exactly 10 MB", async () => {
    const h = await writeFixture({ files: { "big.jpg": JPEG_BYTES, "edge.jpg": JPEG_BYTES } })
    await truncate(join(h.uploadDir, "big.jpg"), TEN_MB + 1)
    await truncate(join(h.uploadDir, "edge.jpg"), TEN_MB)

    const error = await toolError(h.watermarkSet.run({ path: join(h.uploadDir, "big.jpg") }))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(`${TEN_MB} bytes`)
    expect(h.writes()).toEqual([])

    await h.watermarkSet.run({ path: join(h.uploadDir, "edge.jpg") })
    expect(h.writes()).toHaveLength(1)
  })

  test("a file that is not there is not_found", async () => {
    const h = await writeFixture()

    expect((await toolError(h.watermarkSet.run({ path: join(h.uploadDir, "none.jpg") }))).code).toBe("not_found")
    expect(h.writes()).toEqual([])
  })
})

describe("google_youtube_watermark_set: a timing that cannot be", () => {
  test.each([
    ["`end` without an offset", { from: "end" }, "required with `from` `end`"],
    ["`end` with an offset of 0", { from: "end", offset_seconds: 0 }, "at least 1"],
    [
      "`end` with a duration longer than the offset",
      { from: "end", offset_seconds: 10, duration_seconds: 11 },
      "at most `offset_seconds` (10)",
    ],
  ])("%s is invalid_argument before any request", async (_name, args, hint) => {
    const h = await writeFixture({ files: { "mark.jpg": JPEG_BYTES } })

    const error = await toolError(h.watermarkSet.run({ path: join(h.uploadDir, "mark.jpg"), ...args }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(hint)
    expect(h.requests).toEqual([])
  })

  test.each([
    ["a negative offset", { offset_seconds: -1 }],
    ["an offset that is not whole", { offset_seconds: 1.5 }],
    ["a duration of 0", { duration_seconds: 0 }],
    ["a duration that is not whole", { duration_seconds: 2.5 }],
    ["an anchor that is neither", { from: "middle" }],
  ])("%s is invalid_argument before any request", async (_name, args) => {
    const h = await writeFixture({ files: { "mark.jpg": JPEG_BYTES } })

    const error = await toolError(h.watermarkSet.run({ path: join(h.uploadDir, "mark.jpg"), ...args }))

    expect(error.code).toBe("invalid_argument")
    expect(h.requests).toEqual([])
  })

  test("a duration longer than the offset is fine when counted from the start", async () => {
    const h = await writeFixture({ files: { "mark.jpg": JPEG_BYTES } })

    await h.watermarkSet.run({ path: join(h.uploadDir, "mark.jpg"), offset_seconds: 1, duration_seconds: 60 })

    expect(h.writes()).toHaveLength(1)
  })
})

describe("google_youtube_watermark_set: the label and Google's refusals", () => {
  test("a label that cannot write is refused before any request", async () => {
    const h = await writeFixture({ credential: READ_ONLY_CREDENTIAL, files: { "mark.jpg": JPEG_BYTES } })

    const error = await toolError(h.watermarkSet.run({ path: join(h.uploadDir, "mark.jpg") }))

    expect(error.code).toBe("unauthenticated")
    expect(h.requests).toEqual([])
  })

  test("an account with no channel is not_found, posting nothing", async () => {
    const h = await writeFixture({
      files: { "mark.jpg": JPEG_BYTES },
      handlers: [respond(CHANNELS_URL, { json: {} })],
    })

    expect((await toolError(h.watermarkSet.run({ path: join(h.uploadDir, "mark.jpg") }))).code).toBe("not_found")
    expect(h.writes()).toEqual([])
  })

  test.each([
    ["imageFormatUnsupported", 400, "invalid_argument"],
    ["imageTooTall", 400, "invalid_argument"],
    ["imageTooWide", 400, "invalid_argument"],
    ["mediaBodyRequired", 400, "invalid_argument"],
    ["channelNotFound", 404, "not_found"],
    ["forbidden", 403, "forbidden"],
  ])("a %s answer (%d) is %s", async (reason, status, code) => {
    const h = await writeFixture({
      files: { "mark.jpg": JPEG_BYTES },
      handlers: [watermarkSetHandler(refusal(status, reason, "Google says no."))],
    })

    const error = await toolError(h.watermarkSet.run({ path: join(h.uploadDir, "mark.jpg") }))

    expect<string>(error.code).toBe(code)
    expect(error.message).toContain("Google says no.")
  })

  test("a spent quota says when it resets", async () => {
    const h = await writeFixture({
      files: { "mark.jpg": JPEG_BYTES },
      handlers: [watermarkSetHandler(refusal(403, "quotaExceeded", "Quota."))],
    })

    const error = await toolError(h.watermarkSet.run({ path: join(h.uploadDir, "mark.jpg") }))

    expect(error.code).toBe("rate_limited")
    expect(error.message).toEndWith(" The YouTube quota resets at midnight Pacific time.")
  })
})
