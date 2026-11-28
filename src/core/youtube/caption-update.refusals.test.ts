import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, symlink, truncate, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { toolError } from "../google/client.fixtures"
import { HUNDRED_MB, SRT } from "./caption.testing"
import {
  OTHER_CHANNEL,
  READ_ONLY_CREDENTIAL,
  TITLE,
  TRACK,
  TRACK_ASR,
  TRACK_DRAFT,
  VIDEO,
  captionUpdateHandler,
  captionUpdateMediaHandler,
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

describe("google_youtube_caption_update: a file that cannot be sent", () => {
  test("is forbidden when no upload directory is set", async () => {
    const h = await writeFixture({ files: { "en.srt": SRT }, uploadDirs: () => [] })

    const error = await toolError(h.captionUpdate.run({ path: join(h.uploadDir, "en.srt") }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("No upload directory is set")
    expect(h.writes()).toEqual([])
  })

  test("is forbidden outside the upload directories", async () => {
    const h = await writeFixture({
      files: { "en.srt": SRT },
      uploadDirs: (uploadDir) => [join(uploadDir, "elsewhere")],
    })

    const error = await toolError(h.captionUpdate.run({ path: join(h.uploadDir, "en.srt") }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("upload_dirs")
    expect(h.writes()).toEqual([])
  })

  test("is forbidden under encrypt_dirs, saying why, and nothing is sent or read", async () => {
    const h = await withSecretDir()
    await mkdir(join(h.uploadDir, "secret"))
    await writeFile(join(h.uploadDir, "secret", "en.srt"), SRT)

    const error = await toolError(h.captionUpdate.run({ path: join(h.uploadDir, "secret", "en.srt") }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("only ciphertext")
    expect(h.lines()).toEqual([])
  })

  test("is forbidden through a link into encrypt_dirs", async () => {
    const h = await withSecretDir()
    await mkdir(join(h.uploadDir, "secret"))
    await writeFile(join(h.uploadDir, "secret", "en.srt"), SRT)
    await symlink(join(h.uploadDir, "secret"), join(h.uploadDir, "link"))

    const error = await toolError(h.captionUpdate.run({ path: join(h.uploadDir, "link", "en.srt") }))

    expect(error.code).toBe("forbidden")
    expect(h.writes()).toEqual([])
  })

  test("a relative path is invalid_argument before any request", async () => {
    const h = await writeFixture()

    const error = await toolError(h.captionUpdate.run({ path: "en.srt" }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("absolute")
    expect(h.requests).toEqual([])
  })

  test.each([
    ["a file of another extension", "captions.txt"],
    ["a file with no extension", "captions"],
  ])("refuses %s as invalid_argument, naming the formats and sending nothing", async (_name, file) => {
    const h = await writeFixture({ files: { [file]: SRT } })

    const error = await toolError(h.captionUpdate.run({ path: join(h.uploadDir, file) }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(".srt, .vtt, .sbv, .ttml, .dfxp, .scc")
    expect(h.writes()).toEqual([])
  })

  test("refuses a file over 100 MB, and sends one of exactly 100 MB", async () => {
    const h = await writeFixture({ files: { "big.srt": SRT, "edge.srt": SRT } })
    await truncate(join(h.uploadDir, "big.srt"), HUNDRED_MB + 1)
    await truncate(join(h.uploadDir, "edge.srt"), HUNDRED_MB)

    const error = await toolError(h.captionUpdate.run({ path: join(h.uploadDir, "big.srt") }))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(`${HUNDRED_MB} bytes`)
    expect(h.writes()).toEqual([])

    await h.captionUpdate.run({ path: join(h.uploadDir, "edge.srt") })
    expect(h.writes()).toHaveLength(1)
  })

  test("a file that is not there is not_found", async () => {
    const h = await writeFixture()

    expect((await toolError(h.captionUpdate.run({ path: join(h.uploadDir, "none.srt") }))).code).toBe("not_found")
    expect(h.writes()).toEqual([])
  })
})

describe("google_youtube_caption_update: a call that changes nothing, or something that cannot be changed", () => {
  test("neither a file nor a draft state is invalid_argument before any request", async () => {
    const h = await writeFixture()

    const error = await toolError(h.captionUpdate.run())

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("`path`")
    expect(error.message).toContain("`draft`")
    expect(h.requests).toEqual([])
  })

  test.each([
    ["a published track kept published", TRACK, false, "published"],
    ["a draft kept a draft", TRACK_DRAFT, true, "a draft"],
  ])("%s with no file is invalid_argument, nothing sent", async (_name, caption, draft, state) => {
    const h = await writeFixture()

    const error = await toolError(h.captionUpdate.run({ caption, draft }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(`already ${state}`)
    expect(h.writes()).toEqual([])
  })

  test("a track that is not one of the video's is not_found, nothing sent", async () => {
    const h = await writeFixture()

    const error = await toolError(h.captionUpdate.run({ caption: "cap_other_0009", draft: true }))

    expect(error.code).toBe("not_found")
    expect(error.message).toContain("is not one of the video's caption tracks")
    expect(h.writes()).toEqual([])
  })

  test("a video with no tracks gives not_found", async () => {
    const h = await writeFixture({ handlers: [{ ...captionsHandler(), reply: { json: {} } }] })

    expect((await toolError(h.captionUpdate.run({ draft: true }))).code).toBe("not_found")
    expect(h.writes()).toEqual([])
  })

  test("YouTube's automatic track is invalid_argument for a file and for a draft state alike", async () => {
    const h = await writeFixture({ files: { "en.srt": SRT } })

    const withFile = await toolError(h.captionUpdate.run({ caption: TRACK_ASR, path: join(h.uploadDir, "en.srt") }))
    const draftOnly = await toolError(h.captionUpdate.run({ caption: TRACK_ASR, draft: true }))

    for (const error of [withFile, draftOnly]) {
      expect(error.code).toBe("invalid_argument")
      expect(error.message).toContain("automatic track")
    }
    expect(h.writes()).toEqual([])
  })

  test("a track id that is no id is invalid_argument before any request", async () => {
    const h = await writeFixture()

    const error = await toolError(h.captionUpdate.run({ caption: "x/y", draft: true }))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("is not a caption track id")
    expect(h.requests).toEqual([])
  })
})

describe("google_youtube_caption_update: a video that is not the channel's to change", () => {
  test("another channel's video is forbidden, names the video, lists no tracks and sends nothing", async () => {
    const h = await writeFixture({
      handlers: [videoHandler(writableVideo({ snippet: { channelId: OTHER_CHANNEL } }))],
    })

    const error = await toolError(h.captionUpdate.run({ draft: true }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain(`"${TITLE}"`)
    expect(error.message).toContain(VIDEO)
    expect(error.message).toContain("Nothing was sent")
    expect(h.writes()).toEqual([])
    expect(h.lines().filter((line) => line.endsWith("/captions"))).toEqual([])
  })

  test("a video Google does not return is not_found", async () => {
    const h = await writeFixture({ handlers: [videoReplyHandler({ json: {} })] })

    expect((await toolError(h.captionUpdate.run({ draft: true }))).code).toBe("not_found")
    expect(h.writes()).toEqual([])
  })

  test("a label that cannot write is refused before any request", async () => {
    const h = await writeFixture({ credential: READ_ONLY_CREDENTIAL })

    const error = await toolError(h.captionUpdate.run({ draft: true }))

    expect(error.code).toBe("unauthenticated")
    expect(h.requests).toEqual([])
  })
})

describe("google_youtube_caption_update: Google's refusals", () => {
  const sendDraft = async (reply: ReturnType<typeof refusal>) => {
    const h = await writeFixture({ handlers: [captionUpdateHandler(reply)] })
    return toolError(h.captionUpdate.run({ draft: true }))
  }

  const sendFile = async (reply: ReturnType<typeof refusal>) => {
    const h = await writeFixture({ files: { "en.srt": SRT }, handlers: [captionUpdateMediaHandler(reply)] })
    return toolError(h.captionUpdate.run({ path: join(h.uploadDir, "en.srt") }))
  }

  test.each([
    ["invalidMetadata", "The request metadata is invalid."],
    ["contentRequired", "The caption file is missing."],
  ])("a 400 %s is invalid_argument with Google's message, on either route", async (reason, message) => {
    for (const send of [sendDraft, sendFile]) {
      const error = await send(refusal(400, reason, message))

      expect(error.code).toBe("invalid_argument")
      expect(error.message).toContain(message)
    }
  })

  test("a 409 captionExists is invalid_argument and points to the update", async () => {
    const error = await sendFile(refusal(409, "captionExists", "The caption track already exists."))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("google_youtube_caption_update")
  })

  test("a 403 forbidden stays forbidden with Google's message", async () => {
    const error = await sendDraft(refusal(403, "forbidden", "The caller is not allowed to change captions."))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("The caller is not allowed to change captions.")
  })

  test("a spent quota is rate_limited and says when the quota resets", async () => {
    const error = await sendFile(refusal(403, "quotaExceeded", "Out of quota."))

    expect(error.code).toBe("rate_limited")
    expect(error.message).toEndWith(" The YouTube quota resets at midnight Pacific time.")
  })
})
