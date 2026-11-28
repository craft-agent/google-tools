import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, symlink, truncate, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { toolError } from "../google/client.fixtures"
import { HUNDRED_MB, SRT } from "./caption.testing"
import {
  OTHER_CHANNEL,
  READ_ONLY_CREDENTIAL,
  TITLE,
  VIDEO,
  captionInsertHandler,
  captionsHandler,
  cleanUp,
  freshTokens,
  refusal,
  videoHandler,
  videoReplyHandler,
  writableVideo,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

/** A fixture with `secret` in its upload directory named by `encrypt_dirs`. */
const withSecretDir = () => writeFixture({ settings: (uploadDir) => ({ encrypt_dirs: [join(uploadDir, "secret")] }) })

describe("google_youtube_caption_add: a file that cannot be sent", () => {
  test("is forbidden when no upload directory is set", async () => {
    const h = await writeFixture({ files: { "en.srt": SRT }, uploadDirs: () => [] })

    const error = await toolError(h.captionAdd.run({ path: join(h.uploadDir, "en.srt") }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("No upload directory is set")
    expect(h.writes()).toEqual([])
  })

  test("is forbidden outside the upload directories", async () => {
    const h = await writeFixture({
      files: { "en.srt": SRT },
      uploadDirs: (uploadDir) => [join(uploadDir, "elsewhere")],
    })

    const error = await toolError(h.captionAdd.run({ path: join(h.uploadDir, "en.srt") }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("upload_dirs")
    expect(h.writes()).toEqual([])
  })

  test("is forbidden under encrypt_dirs, saying why, and nothing is sent or read", async () => {
    const h = await withSecretDir()
    await mkdir(join(h.uploadDir, "secret"))
    await writeFile(join(h.uploadDir, "secret", "en.srt"), SRT)

    const error = await toolError(h.captionAdd.run({ path: join(h.uploadDir, "secret", "en.srt") }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("only ciphertext")
    expect(h.lines()).toEqual([])
  })

  test("is forbidden through a link into encrypt_dirs", async () => {
    const h = await withSecretDir()
    await mkdir(join(h.uploadDir, "secret"))
    await writeFile(join(h.uploadDir, "secret", "en.srt"), SRT)
    await symlink(join(h.uploadDir, "secret"), join(h.uploadDir, "link"))

    const error = await toolError(h.captionAdd.run({ path: join(h.uploadDir, "link", "en.srt") }))

    expect(error.code).toBe("forbidden")
    expect(h.writes()).toEqual([])
  })

  test("a relative path is invalid_argument before any request", async () => {
    const h = await writeFixture()

    const error = await toolError(h.captionAdd.run({ path: "en.srt" }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("absolute")
    expect(h.requests).toEqual([])
  })

  test.each([
    ["a file of another extension", "captions.txt"],
    ["a file with no extension", "captions"],
    ["a video", "captions.mp4"],
    ["an extension that only ends like one", "captions.srt.bak"],
  ])("refuses %s as invalid_argument, naming the formats and sending nothing", async (_name, file) => {
    const h = await writeFixture({ files: { [file]: SRT } })

    const error = await toolError(h.captionAdd.run({ path: join(h.uploadDir, file) }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(".srt, .vtt, .sbv, .ttml, .dfxp, .scc")
    expect(h.writes()).toEqual([])
  })

  test("refuses a file over 100 MB, and sends one of exactly 100 MB", async () => {
    const h = await writeFixture({ files: { "big.srt": SRT, "edge.srt": SRT } })
    await truncate(join(h.uploadDir, "big.srt"), HUNDRED_MB + 1)
    await truncate(join(h.uploadDir, "edge.srt"), HUNDRED_MB)

    const error = await toolError(h.captionAdd.run({ path: join(h.uploadDir, "big.srt") }))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(`${HUNDRED_MB} bytes`)
    expect(h.writes()).toEqual([])

    await h.captionAdd.run({ path: join(h.uploadDir, "edge.srt") })
    expect(h.writes()).toHaveLength(1)
  })

  test("a file that is not there is not_found", async () => {
    const h = await writeFixture()

    expect((await toolError(h.captionAdd.run({ path: join(h.uploadDir, "none.srt") }))).code).toBe("not_found")
    expect(h.writes()).toEqual([])
  })
})

describe("google_youtube_caption_add: arguments Google would refuse", () => {
  test.each([
    ["a language that is no tag", { language: "english_US" }, "language tag"],
    ["a blank language", { language: "" }, "language tag"],
    ["a name of 151 characters", { name: "x".repeat(151) }, "at most 150 characters"],
    ["a name with a line break", { name: "English\nsubtitles" }, "control characters"],
    ["a video that is no video", { video: "short" }, "is not a video id"],
  ])("refuses %s as invalid_argument before any request", async (_name, args, message) => {
    const h = await writeFixture({ files: { "en.srt": SRT } })

    const error = await toolError(h.captionAdd.run({ path: join(h.uploadDir, "en.srt"), ...args }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(message)
    expect(h.requests).toEqual([])
  })

  test("takes a name of exactly 150 characters and an empty one", async () => {
    const h = await writeFixture({ files: { "en.srt": SRT } })

    await h.captionAdd.run({ path: join(h.uploadDir, "en.srt"), name: "😀".repeat(150) })
    await h.captionAdd.run({ path: join(h.uploadDir, "en.srt"), name: "" })

    expect(h.writes()).toHaveLength(2)
  })
})

describe("google_youtube_caption_add: a video that is not the channel's to change", () => {
  test("another channel's video is forbidden, names the video, lists no tracks and posts nothing", async () => {
    const h = await writeFixture({
      files: { "en.srt": SRT },
      handlers: [videoHandler(writableVideo({ snippet: { channelId: OTHER_CHANNEL } }))],
    })

    const error = await toolError(h.captionAdd.run({ path: join(h.uploadDir, "en.srt") }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain(`"${TITLE}"`)
    expect(error.message).toContain(VIDEO)
    expect(error.message).toContain("Nothing was sent")
    expect(h.writes()).toEqual([])
    expect(h.lines().filter((line) => line.endsWith("/captions"))).toEqual([])
  })

  test("a video Google does not return is not_found", async () => {
    const h = await writeFixture({ files: { "en.srt": SRT }, handlers: [videoReplyHandler({ json: {} })] })

    expect((await toolError(h.captionAdd.run({ path: join(h.uploadDir, "en.srt") }))).code).toBe("not_found")
    expect(h.writes()).toEqual([])
  })

  test("a label that cannot write is refused before any request", async () => {
    const h = await writeFixture({ credential: READ_ONLY_CREDENTIAL, files: { "en.srt": SRT } })

    const error = await toolError(h.captionAdd.run({ path: join(h.uploadDir, "en.srt") }))

    expect(error.code).toBe("unauthenticated")
    expect(h.requests).toEqual([])
  })

  test("a caption list Google refuses stops the call before the post", async () => {
    const h = await writeFixture({
      files: { "en.srt": SRT },
      handlers: [{ ...captionsHandler(), reply: refusal(403, "forbidden", "No captions for you.") }],
    })

    const error = await toolError(h.captionAdd.run({ path: join(h.uploadDir, "en.srt") }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("No captions for you.")
    expect(h.writes()).toEqual([])
  })
})

describe("google_youtube_caption_add: Google's refusals", () => {
  const send = async (reply: ReturnType<typeof refusal>) => {
    const h = await writeFixture({ files: { "en.srt": SRT }, handlers: [captionInsertHandler(reply)] })
    return toolError(h.captionAdd.run({ path: join(h.uploadDir, "en.srt") }))
  }

  test.each([
    ["invalidMetadata", "The request metadata is invalid."],
    ["nameTooLong", "The caption name is too long."],
    ["contentRequired", "The caption file is missing."],
  ])("a 400 %s is invalid_argument with Google's message", async (reason, message) => {
    const error = await send(refusal(400, reason, message))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(message)
  })

  test("a 400 for a file without timings stays upstream_error with Google's message", async () => {
    const error = await send(refusal(400, "badRequest", "The caption file has no timings."))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("The caption file has no timings.")
  })

  test("a 409 captionExists is invalid_argument and points to google_youtube_caption_update", async () => {
    const error = await send(refusal(409, "captionExists", "The caption track already exists."))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("already has a caption track of that language and name")
    expect(error.message).toContain("google_youtube_caption_update")
    expect(error.message).toContain("The caption track already exists")
  })

  test("a 403 forbidden stays forbidden with Google's message", async () => {
    const error = await send(refusal(403, "forbidden", "The caller is not allowed to add captions."))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("The caller is not allowed to add captions.")
  })

  test("a spent quota is rate_limited and says when the quota resets", async () => {
    const error = await send(refusal(403, "quotaExceeded", "Out of quota."))

    expect(error.code).toBe("rate_limited")
    expect(error.message).toEndWith(" The YouTube quota resets at midnight Pacific time.")
  })
})
