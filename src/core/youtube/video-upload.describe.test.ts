import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { ALL_TRANSLATIONS } from "../../words"
import { wholeCallDescription } from "../describe"
import { googleYoutubeVideoUpload } from "./video-upload"
import { CALL, OTHER_CHANNEL, cleanUp, freshTokens, uploadFixture } from "./video-upload.testing"
import { CHANNEL, channelHandler } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

describe("google_youtube_video_upload describe", () => {
  test("headlines the call's title and shows private, made for kids, the file, its size and its type", async () => {
    const h = await uploadFixture({ files: { "clip.mp4": "made-up video" } })
    const path = join(h.uploadDir, "clip.mp4")

    const description = await h.describe({ path })

    expect(description.headline).toEqual({ text: "About to upload {title}", values: { title: CALL.title } })
    expect(description.facts).toEqual([
      { label: "Privacy", value: { text: "private" } },
      { label: "Made for kids", value: { text: "no" } },
      { label: "From", value: path },
      { label: "Size", value: { text: "{bytes} bytes", values: { bytes: 13 } } },
      { label: "Type", value: "video/mp4" },
    ])
    expect(description.text).toBeUndefined()
  })

  test("says yes when the video is made for kids", async () => {
    const h = await uploadFixture({ files: { "clip.mp4": "made-up video" } })

    const { facts } = await h.describe({ path: join(h.uploadDir, "clip.mp4"), made_for_kids: true })

    expect(facts[1]).toEqual({ label: "Made for kids", value: { text: "yes" } })
  })

  test("shows the description as the text, and none for an empty one", async () => {
    const h = await uploadFixture({ files: { "clip.mp4": "made-up video" } })
    const path = join(h.uploadDir, "clip.mp4")

    expect((await h.describe({ path, description: "About made-up things." })).text).toEqual({
      label: "Description",
      body: "About made-up things.",
    })
    expect((await h.describe({ path, description: "" })).text).toBeUndefined()
  })

  test("pins the file's content and the channel, and a file or a channel that changed gives another pin", async () => {
    const h = await uploadFixture({ files: { "clip.mp4": "made-up video" } })
    const path = join(h.uploadDir, "clip.mp4")
    const base = (await h.describe({ path })).pins

    expect(base).toEqual({ content: expect.stringMatching(/^[0-9a-f]{64}$/), channel: CHANNEL })
    expect((await h.describe({ path })).pins).toEqual(base)

    await writeFile(path, "another video")
    const changedFile = (await h.describe({ path })).pins
    expect(changedFile?.content).not.toBe(base?.content)
    expect(changedFile?.channel).toBe(CHANNEL)

    const other = await uploadFixture({
      handlers: [channelHandler(OTHER_CHANNEL)],
      files: { "clip.mp4": "made-up video" },
    })
    const changedChannel = (await other.describe({ path: join(other.uploadDir, "clip.mp4") })).pins
    expect(changedChannel?.channel).toBe(OTHER_CHANNEL)
    expect(changedChannel?.content).toBe(base?.content)
  })

  test("is a description the prompt can use", async () => {
    const h = await uploadFixture({ files: { "clip.mp4": "made-up video" } })

    const whole = await wholeCallDescription(
      googleYoutubeVideoUpload,
      { ...CALL, path: join(h.uploadDir, "clip.mp4") },
      h.ctx,
    )

    expect(whole?.headline).toEqual({ text: "About to upload {title}", values: { title: CALL.title } })
    expect(whole?.facts).toHaveLength(5)
  })

  test("has its title, intent and words in Japanese", () => {
    const ja = ALL_TRANSLATIONS.ja!
    expect(ja[googleYoutubeVideoUpload.title]).toBeDefined()
    expect(ja[googleYoutubeVideoUpload.intent!]).toBeDefined()
    expect(ja["About to upload {title}"]).toContain("{title}")
    for (const word of ["Made for kids", "Description", "yes", "no"]) expect(ja[word]).toBeDefined()
  })
})

describe("google_youtube_video_upload targets", () => {
  test("is the label's channel", async () => {
    const h = await uploadFixture({ files: { "clip.mp4": "made-up video" } })

    expect(await h.targets({ path: join(h.uploadDir, "clip.mp4") })).toEqual([`work/channels/${CHANNEL}`])
  })

  test("is * when the plan cannot tell: a file that is not there", async () => {
    const h = await uploadFixture()

    expect(await h.targets({ path: join(h.uploadDir, "none.mp4") })).toEqual(["*"])
  })
})
