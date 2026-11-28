import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readdirSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { toolError } from "../google/client.fixtures"
import type { FakeHandler } from "../google/fake-google.testing"
import { SMALL_CHUNK, UPLOAD_URL, cleanUp, freshTokens, rangesOf, refusal, uploadFixture } from "./video-upload.testing"
import { CHANNEL, CHANNELS_URL } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const SIZE = 600_000

/** The directory that lists the descriptors this process holds open. */
const OPEN_FILES = "/dev/fd"

/** What Google's advice to look first says, which only a failure after the session started carries. */
const LOOK_FIRST =
  "Before uploading again, look at `google_youtube_read` method `my_videos`: the video may have been made."

const RESET = " The YouTube quota resets at midnight Pacific time."

/** A file of `size` bytes whose content varies from one byte to the next. */
const patterned = (size: number) => Buffer.from(Array.from({ length: size }, (_, index) => (index * 7) % 251))

/** The start of the session, answered with `reply`. */
const startReply = (reply: FakeHandler["reply"]): FakeHandler => ({ method: "POST", url: UPLOAD_URL, reply })

/** A chunk, answered with `reply`. */
const chunkReply = (reply: FakeHandler["reply"]): FakeHandler => ({ method: "PUT", url: UPLOAD_URL, reply })

/** A fixture whose file `big.mp4` is replaced by what `change` gives at the channel read, which comes after the plan hashed it. */
async function withFileChangedBeforeSending(change: (content: Buffer) => Buffer) {
  let replace: (() => Promise<void>) | undefined
  const read: FakeHandler = {
    method: "GET",
    url: CHANNELS_URL,
    reply: async () => {
      await replace?.()
      return { json: { items: [{ id: CHANNEL }] } }
    },
  }
  const h = await uploadFixture({ handlers: [read], files: { "big.mp4": patterned(SIZE) } })
  const path = join(h.uploadDir, "big.mp4")
  replace = () => writeFile(path, change(patterned(SIZE)))
  return { ...h, path }
}

describe("google_youtube_video_upload when the file changes after it was read", () => {
  test("holds the last chunk and is stale when the content changed, with no advice to look first", async () => {
    const h = await withFileChangedBeforeSending((content) => {
      content[SIZE - 1] = content[SIZE - 1]! ^ 1
      return content
    })
    const before = readdirSync(OPEN_FILES).length

    const error = await toolError(h.upload({ path: h.path }))

    expect(error.code).toBe("stale")
    expect(error.message).toBe("The file changed after it was read; no video was made.")
    expect(rangesOf(h)).toEqual([
      `bytes 0-${SMALL_CHUNK - 1}/${SIZE}`,
      `bytes ${SMALL_CHUNK}-${2 * SMALL_CHUNK - 1}/${SIZE}`,
    ])
    expect(readdirSync(OPEN_FILES).length).toBeLessThanOrEqual(before)
  })

  test("a change in the first byte is caught as well, before the last chunk goes", async () => {
    const h = await withFileChangedBeforeSending((content) => {
      content[0] = content[0]! ^ 1
      return content
    })

    expect((await toolError(h.upload({ path: h.path }))).code).toBe("stale")
    expect(rangesOf(h).some((range) => range?.endsWith(`${SIZE - 1}/${SIZE}`))).toBe(false)
  })

  test("a file that is another size when it is sent is stale, and no session is opened", async () => {
    const h = await withFileChangedBeforeSending((content) => content.subarray(0, SIZE - 1))

    expect((await toolError(h.upload({ path: h.path }))).code).toBe("stale")
    expect(h.uploads()).toEqual([])
  })
})

describe("google_youtube_video_upload when Google refuses", () => {
  test.each([
    ["a 400 uploadLimitExceeded", refusal(400, "uploadLimitExceeded", "The user has uploaded too many videos.")],
    ["a 400 uploadRateLimitExceeded", refusal(400, "uploadRateLimitExceeded", "Too many uploads.")],
  ])(
    "%s at the start is rate_limited, says the channel's uploads are used up and when the quota resets",
    async (_name, reply) => {
      const h = await uploadFixture({ handlers: [startReply(reply)], files: { "clip.mp4": "made-up video" } })

      const error = await toolError(h.upload({ path: join(h.uploadDir, "clip.mp4") }))

      expect(error.code).toBe("rate_limited")
      expect(error.message).toContain("The channel has uploaded as many videos as YouTube allows for now")
      expect(error.message).toEndWith(RESET)
      expect(error.message).not.toContain(LOOK_FIRST)
      expect(rangesOf(h)).toEqual([])
    },
  )

  test("a refused start fails with Google's code and does not send the advice to look first", async () => {
    const h = await uploadFixture({
      handlers: [startReply(refusal(403, "forbidden", "The channel cannot upload."))],
      files: { "clip.mp4": "made-up video" },
    })

    const error = await toolError(h.upload({ path: join(h.uploadDir, "clip.mp4") }))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("The channel cannot upload.")
    expect(error.message).not.toContain(LOOK_FIRST)
  })

  test("a failure after the session started says to look at my_videos before uploading again", async () => {
    const h = await uploadFixture({
      handlers: [chunkReply({ status: 500, json: { error: { message: "backend" } } })],
      files: { "big.mp4": patterned(SIZE) },
    })

    const error = await toolError(h.upload({ path: join(h.uploadDir, "big.mp4") }))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toEndWith(LOOK_FIRST)
    expect(rangesOf(h)).toHaveLength(1)
  })

  test("a limit reached in a chunk is rate_limited and still says to look first", async () => {
    const h = await uploadFixture({
      handlers: [chunkReply(refusal(400, "uploadLimitExceeded", "The user has uploaded too many videos."))],
      files: { "clip.mp4": "made-up video" },
    })

    const error = await toolError(h.upload({ path: join(h.uploadDir, "clip.mp4") }))

    expect(error.code).toBe("rate_limited")
    expect(error.message).toContain(RESET)
    expect(error.message).toEndWith(LOOK_FIRST)
  })

  test("a session that gives up after three resends says to look first", async () => {
    const h = await uploadFixture({ files: { "big.mp4": patterned(SIZE) }, session: { acknowledge: () => 0 } })

    const error = await toolError(h.upload({ path: join(h.uploadDir, "big.mp4") }))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toEndWith(LOOK_FIRST)
    expect(rangesOf(h)).toHaveLength(4)
  })
})
