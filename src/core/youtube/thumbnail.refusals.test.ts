import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, symlink, truncate, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { toolError } from "../google/client.fixtures"
import { FIFTY_MB, JPEG_BYTES, PNG_BYTES } from "./thumbnail.testing"
import {
  OTHER_CHANNEL,
  READ_ONLY_CREDENTIAL,
  TITLE,
  VIDEO,
  cleanUp,
  freshTokens,
  refusal,
  thumbnailHandler,
  videoHandler,
  videoReplyHandler,
  writableVideo,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

/** A fixture with `secret` in its upload directory named by `encrypt_dirs`. */
const withSecretDir = () => writeFixture({ settings: (uploadDir) => ({ encrypt_dirs: [join(uploadDir, "secret")] }) })

describe("google_youtube_thumbnail_set: a file that cannot be sent", () => {
  test("is forbidden when no upload directory is set", async () => {
    const h = await writeFixture({ files: { "cover.jpg": JPEG_BYTES }, uploadDirs: () => [] })

    const error = await toolError(h.thumbnail.run({ path: join(h.uploadDir, "cover.jpg") }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("No upload directory is set")
    expect(h.writes()).toEqual([])
  })

  test("is forbidden outside the upload directories", async () => {
    const h = await writeFixture({
      files: { "cover.jpg": JPEG_BYTES },
      uploadDirs: (uploadDir) => [join(uploadDir, "elsewhere")],
    })

    const error = await toolError(h.thumbnail.run({ path: join(h.uploadDir, "cover.jpg") }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("upload_dirs")
    expect(h.writes()).toEqual([])
  })

  test("is forbidden under encrypt_dirs, saying why, and nothing is sent", async () => {
    const h = await withSecretDir()
    await mkdir(join(h.uploadDir, "secret"))
    await writeFile(join(h.uploadDir, "secret", "cover.jpg"), JPEG_BYTES)

    const error = await toolError(h.thumbnail.run({ path: join(h.uploadDir, "secret", "cover.jpg") }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("only ciphertext")
    expect(h.writes()).toEqual([])
    expect(h.lines().filter((line) => line.startsWith("GET"))).toEqual([])
  })

  test("is forbidden through a link into encrypt_dirs", async () => {
    const h = await withSecretDir()
    await mkdir(join(h.uploadDir, "secret"))
    await writeFile(join(h.uploadDir, "secret", "cover.jpg"), JPEG_BYTES)
    await symlink(join(h.uploadDir, "secret"), join(h.uploadDir, "link"))

    const error = await toolError(h.thumbnail.run({ path: join(h.uploadDir, "link", "cover.jpg") }))

    expect(error.code).toBe("forbidden")
    expect(h.writes()).toEqual([])
  })

  test("a relative path is invalid_argument before any request", async () => {
    const h = await writeFixture()

    const error = await toolError(h.thumbnail.run({ path: "cover.jpg" }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("absolute")
    expect(h.requests).toEqual([])
  })

  test.each([
    ["a file of another extension", "cover.gif", JPEG_BYTES, ".jpg, .jpeg or .png"],
    ["a file with no extension", "cover", JPEG_BYTES, ".jpg, .jpeg or .png"],
    ["a .jpg that holds a PNG", "cover.jpg", PNG_BYTES, "not one"],
    ["a .png that holds a JPEG", "cover.png", JPEG_BYTES, "not one"],
    ["a .jpeg that holds text", "cover.jpeg", "not an image", "not one"],
    ["an empty .png", "cover.png", "", "not one"],
  ])("refuses %s as invalid_argument, sending nothing", async (_name, file, content, hint) => {
    const h = await writeFixture({ files: { [file]: content } })

    const error = await toolError(h.thumbnail.run({ path: join(h.uploadDir, file) }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(hint)
    expect(h.writes()).toEqual([])
  })

  test("refuses a file over 50 MB, and sends one of exactly 50 MB", async () => {
    const h = await writeFixture({ files: { "big.jpg": JPEG_BYTES, "edge.jpg": JPEG_BYTES } })
    await truncate(join(h.uploadDir, "big.jpg"), FIFTY_MB + 1)
    await truncate(join(h.uploadDir, "edge.jpg"), FIFTY_MB)

    const error = await toolError(h.thumbnail.run({ path: join(h.uploadDir, "big.jpg") }))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(`${FIFTY_MB} bytes`)
    expect(h.writes()).toEqual([])

    await h.thumbnail.run({ path: join(h.uploadDir, "edge.jpg") })
    expect(h.writes()).toHaveLength(1)
  })

  test("a file that is not there is not_found", async () => {
    const h = await writeFixture()

    expect((await toolError(h.thumbnail.run({ path: join(h.uploadDir, "none.jpg") }))).code).toBe("not_found")
    expect(h.writes()).toEqual([])
  })
})

describe("google_youtube_thumbnail_set: a video that is not the channel's to change", () => {
  test("another channel's video is forbidden, names the video and posts nothing", async () => {
    const h = await writeFixture({
      files: { "cover.jpg": JPEG_BYTES },
      handlers: [videoHandler(writableVideo({ snippet: { channelId: OTHER_CHANNEL } }))],
    })

    const error = await toolError(h.thumbnail.run({ path: join(h.uploadDir, "cover.jpg") }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain(`"${TITLE}"`)
    expect(error.message).toContain(VIDEO)
    expect(error.message).toContain("Nothing was sent")
    expect(h.writes()).toEqual([])
  })

  test("a video Google does not return is not_found", async () => {
    const h = await writeFixture({
      files: { "cover.jpg": JPEG_BYTES },
      handlers: [videoReplyHandler({ json: {} })],
    })

    expect((await toolError(h.thumbnail.run({ path: join(h.uploadDir, "cover.jpg") }))).code).toBe("not_found")
    expect(h.writes()).toEqual([])
  })

  test("a label that cannot write is refused before any request", async () => {
    const h = await writeFixture({ credential: READ_ONLY_CREDENTIAL, files: { "cover.jpg": JPEG_BYTES } })

    const error = await toolError(h.thumbnail.run({ path: join(h.uploadDir, "cover.jpg") }))

    expect(error.code).toBe("unauthenticated")
    expect(h.requests).toEqual([])
  })
})

describe("google_youtube_thumbnail_set: Google's refusals", () => {
  test("a 403 forbidden keeps Google's message and adds the advice to verify the channel", async () => {
    const h = await writeFixture({
      files: { "cover.jpg": JPEG_BYTES },
      handlers: [thumbnailHandler(refusal(403, "forbidden", "The channel cannot set thumbnails."))],
    })

    const error = await toolError(h.thumbnail.run({ path: join(h.uploadDir, "cover.jpg") }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("The channel cannot set thumbnails.")
    expect(error.message).toContain("verify it in YouTube Studio (youtube.com/verify)")
  })

  test.each([
    ["a 429", refusal(429, "rateLimitExceeded", "Slow down.")],
    ["uploadRateLimitExceeded", refusal(429, "uploadRateLimitExceeded", "Too many uploads.")],
  ])("%s is rate_limited and says when the quota resets", async (_name, reply) => {
    const h = await writeFixture({ files: { "cover.jpg": JPEG_BYTES }, handlers: [thumbnailHandler(reply)] })

    const error = await toolError(h.thumbnail.run({ path: join(h.uploadDir, "cover.jpg") }))

    expect(error.code).toBe("rate_limited")
    expect(error.message).toEndWith(" The YouTube quota resets at midnight Pacific time.")
  })
})
