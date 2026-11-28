import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, symlink, truncate, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { toolError } from "../google/client.fixtures"
import { cleanUp, freshTokens, uploadFixture } from "./video-upload.testing"
import { CHANNELS_URL, READ_ONLY_CREDENTIAL, respond } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const GIB = 1024 ** 3

const FILES = { "clip.mp4": "made-up video" }

/** A fixture with `secret` in its upload directory named by `encrypt_dirs`. */
const withSecretDir = () => uploadFixture({ settings: (uploadDir) => ({ encrypt_dirs: [join(uploadDir, "secret")] }) })

describe("google_youtube_video_upload: a file that cannot be sent", () => {
  test("is forbidden when no upload directory is set, with no request", async () => {
    const h = await uploadFixture({ files: FILES, uploadDirs: () => [] })

    const error = await toolError(h.upload({ path: join(h.uploadDir, "clip.mp4") }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("No upload directory is set")
    expect(h.calls()).toEqual([])
  })

  test("is forbidden outside the upload directories, with no request", async () => {
    const h = await uploadFixture({ files: FILES, uploadDirs: (uploadDir) => [join(uploadDir, "elsewhere")] })

    const error = await toolError(h.upload({ path: join(h.uploadDir, "clip.mp4") }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("upload_dirs")
    expect(h.calls()).toEqual([])
  })

  test("is forbidden under encrypt_dirs, saying why, and not a request is made", async () => {
    const h = await withSecretDir()
    await mkdir(join(h.uploadDir, "secret"))
    await writeFile(join(h.uploadDir, "secret", "clip.mp4"), "made-up video")

    const error = await toolError(h.upload({ path: join(h.uploadDir, "secret", "clip.mp4") }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("only ciphertext")
    expect(h.calls()).toEqual([])
  })

  test("is forbidden through a link into encrypt_dirs", async () => {
    const h = await withSecretDir()
    await mkdir(join(h.uploadDir, "secret"))
    await writeFile(join(h.uploadDir, "secret", "clip.mp4"), "made-up video")
    await symlink(join(h.uploadDir, "secret"), join(h.uploadDir, "link"))

    const error = await toolError(h.upload({ path: join(h.uploadDir, "link", "clip.mp4") }))

    expect(error.code).toBe("forbidden")
    expect(h.calls()).toEqual([])
  })

  test("a relative path is invalid_argument before any request", async () => {
    const h = await uploadFixture()

    const error = await toolError(h.upload({ path: "clip.mp4" }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("absolute")
    expect(h.calls()).toEqual([])
  })

  test.each([
    ["a file of another extension", "clip.gif"],
    ["a file with no extension", "clip"],
    ["a file named only by its extension", ".mp4"],
  ])("refuses %s as invalid_argument, naming the extensions", async (_name, file) => {
    const h = await uploadFixture({ files: { [file]: "made-up video" } })

    const error = await toolError(h.upload({ path: join(h.uploadDir, file) }))

    expect(error.code).toBe("invalid_argument")
    for (const extension of [".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"])
      expect(error.message).toContain(extension)
    expect(h.calls()).toEqual([])
  })

  test("refuses a file over 1 GiB under a limit of 1 GiB, naming the setting and the limit", async () => {
    const h = await uploadFixture({ files: { "big.mp4": "" }, settings: () => ({ youtube_upload_max_gib: 1 }) })
    await truncate(join(h.uploadDir, "big.mp4"), GIB + 1)

    const error = await toolError(h.upload({ path: join(h.uploadDir, "big.mp4") }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("youtube_upload_max_gib")
    expect(error.message).toContain("at most 1 GiB")
    expect(error.message).toContain(`${GIB + 1} bytes`)
    expect(h.calls()).toEqual([])
  })

  test("refuses a file over 2 GiB with no setting, naming the limit it has", async () => {
    const h = await uploadFixture({ files: { "big.mp4": "" } })
    await truncate(join(h.uploadDir, "big.mp4"), 2 * GIB + 1)

    const error = await toolError(h.upload({ path: join(h.uploadDir, "big.mp4") }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("at most 2 GiB")
    expect(h.calls()).toEqual([])
  })

  test("a file that is not there is not_found", async () => {
    const h = await uploadFixture()

    expect((await toolError(h.upload({ path: join(h.uploadDir, "none.mp4") }))).code).toBe("not_found")
    expect(h.calls()).toEqual([])
  })
})

describe("google_youtube_video_upload: arguments Google would refuse", () => {
  test("made_for_kids is required: the declaration has no default", async () => {
    const h = await uploadFixture({ files: FILES })

    const error = await toolError(h.upload({ path: join(h.uploadDir, "clip.mp4"), made_for_kids: undefined }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("made_for_kids")
    expect(h.calls()).toEqual([])
  })

  test("an argument it does not take is refused", async () => {
    const h = await uploadFixture({ files: FILES })

    const error = await toolError(h.upload({ path: join(h.uploadDir, "clip.mp4"), privacy: "public" }))

    expect(error.code).toBe("invalid_argument")
    expect(h.calls()).toEqual([])
  })

  test.each([
    ["an empty title", { title: "" }, "`title`"],
    ["a title of 101 characters", { title: "t".repeat(101) }, "`title`"],
    ["a title with markup", { title: "a <b> title" }, "`title`"],
    ["a description over 5000 bytes", { description: "d".repeat(5001) }, "`description`"],
    ["a blank tag", { tags: ["fine", " "] }, "tag"],
    ["a tag with a comma", { tags: ["a,b"] }, "tag"],
    ["tags over 500 characters in all", { tags: Array.from({ length: 6 }, () => "t".repeat(90)) }, "500"],
    ["a category that is no id", { category: "news" }, "category"],
    ["a language that is no tag", { default_language: "english please" }, "`default_language`"],
    ["an audio language that is no tag", { default_audio_language: "1" }, "`default_audio_language`"],
  ])("refuses %s as invalid_argument before any request", async (_name, args, hint) => {
    const h = await uploadFixture({ files: FILES })

    const error = await toolError(h.upload({ path: join(h.uploadDir, "clip.mp4"), ...args }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(hint)
    expect(error.message).toContain("nothing was sent")
    expect(h.calls()).toEqual([])
  })

  test("takes a title of exactly 100 characters and 500 characters of tags", async () => {
    const h = await uploadFixture({ files: FILES })

    await h.upload({
      path: join(h.uploadDir, "clip.mp4"),
      title: "t".repeat(100),
      tags: [...Array.from({ length: 4 }, () => "t".repeat(100)), "t".repeat(96)],
    })

    expect(h.uploads()).toHaveLength(2)
  })
})

describe("google_youtube_video_upload: the label", () => {
  test("a label that cannot write is refused before any request", async () => {
    const h = await uploadFixture({ credential: READ_ONLY_CREDENTIAL, files: FILES })

    const error = await toolError(h.upload({ path: join(h.uploadDir, "clip.mp4") }))

    expect(error.code).toBe("unauthenticated")
    expect(h.requests).toEqual([])
  })

  test("an account with no channel is not_found, and nothing is uploaded", async () => {
    const h = await uploadFixture({ files: FILES, handlers: [respond(CHANNELS_URL, { json: { items: [] } })] })

    const error = await toolError(h.upload({ path: join(h.uploadDir, "clip.mp4") }))

    expect(error.code).toBe("not_found")
    expect(error.message).toContain("no YouTube channel")
    expect(h.uploads()).toEqual([])
  })
})
