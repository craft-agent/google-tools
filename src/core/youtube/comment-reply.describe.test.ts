import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { wholeCallDescription } from "../describe"
import { toolError } from "../google/client.fixtures"
import { ALL_TRANSLATIONS } from "../../words"
import { googleYoutubeCommentReply } from "./comment-reply"
import {
  THREAD,
  TITLE,
  cleanUp,
  freshTokens,
  threadResource,
  threadsHandler,
  videoHandler,
  writableVideo,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

async function described(thread: unknown = threadResource(), video: unknown = writableVideo(), args: unknown = {}) {
  const h = await writeFixture({ handlers: [threadsHandler(thread as { id: string }), videoHandler(video)] })
  return h.commentReply.describe(args)
}

describe("google_youtube_comment_reply describe", () => {
  test("headlines the author of the comment and the video's title as Google has them", async () => {
    const description = await described()

    expect(description.headline).toEqual({
      text: "About to reply to {author} under {title}",
      values: { author: "Someone", title: TITLE },
    })
  })

  test("names an author Google gave none as unknown", async () => {
    const thread = threadResource(THREAD, "Hi", { topLevelComment: { id: THREAD, snippet: { textDisplay: "Hi" } } })

    expect((await described(thread)).headline?.values).toEqual({ author: "unknown", title: TITLE })
  })

  test("shows who can watch the video, the comment replied to and the reply as the text", async () => {
    const description = await described()

    expect(description.facts).toEqual([
      { label: "Privacy", value: { text: "public" } },
      { label: "Comment", value: "A made-up comment." },
    ])
    expect(description.text).toEqual({ label: "Reply", body: "Thanks for watching!" })
  })

  test("shows the whole comment, which the prompt layer cuts", async () => {
    const description = await described(threadResource(THREAD, "あ".repeat(5000)))

    expect(description.facts[1]!.value).toBe("あ".repeat(5000))
  })

  test("pins the video and the thread, which change when the video or the comment does", async () => {
    const pins = async (thread = threadResource(), video = writableVideo()) => (await described(thread, video)).pins
    const base = await pins()

    expect(base).toEqual({
      video: expect.stringMatching(/^[0-9a-f]{64}$/),
      thread: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect(await pins()).toEqual(base)

    const renamed = await pins(undefined, writableVideo({ snippet: { title: "Renamed" } }))
    expect(renamed!.video).not.toBe(base!.video)
    expect(renamed!.thread).toBe(base!.thread)

    const edited = await pins(threadResource(THREAD, "Edited."))
    expect(edited!.thread).not.toBe(base!.thread)
    expect(edited!.video).toBe(base!.video)
  })

  test("is a description the prompt can use", async () => {
    const h = await writeFixture()

    const whole = await wholeCallDescription(googleYoutubeCommentReply, { thread: THREAD, text: "Thanks!" }, h.ctx)

    expect(whole?.headline?.text).toBe("About to reply to {author} under {title}")
    expect(whole?.text?.body).toBe("Thanks!")
  })

  test("has its title, intent and words in Japanese", () => {
    const ja = ALL_TRANSLATIONS.ja!
    expect(ja[googleYoutubeCommentReply.title]).toBeDefined()
    expect(ja[googleYoutubeCommentReply.intent!]).toBeDefined()
    expect(ja["About to reply to {author} under {title}"]).toContain("{author}")
    expect(ja["About to reply to {author} under {title}"]).toContain("{title}")
    for (const word of ["Privacy", "Comment", "Reply"]) expect(ja[word]).toBeDefined()
  })

  test("throws where execute would: a thread that is gone, a video of another channel", async () => {
    const gone = await writeFixture()
    expect((await toolError(gone.commentReply.describe({ thread: "UgxNoSuchThread" }))).code).toBe("not_found")

    const other = await writeFixture({
      handlers: [videoHandler(writableVideo({ snippet: { channelId: "UCotherMadeUpChanId01234" } }))],
    })
    expect((await toolError(other.commentReply.describe())).code).toBe("forbidden")
  })
})
