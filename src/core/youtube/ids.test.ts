import { describe, expect, test } from "bun:test"
import { channelRef, commentId, pageToken, playlistId, videoId } from "./ids"

const VIDEO = "dQw4w9WgXcQ"
const CHANNEL = "UC" + "a".repeat(22)

describe("videoId", () => {
  test.each([
    VIDEO,
    `https://www.youtube.com/watch?v=${VIDEO}`,
    `https://www.youtube.com/watch?v=${VIDEO}&t=10s&list=PLabc`,
    `https://m.youtube.com/watch?v=${VIDEO}`,
    `https://youtu.be/${VIDEO}`,
    `https://youtu.be/${VIDEO}?si=x`,
    `https://www.youtube.com/shorts/${VIDEO}`,
    `https://www.youtube.com/live/${VIDEO}`,
  ])("%s gives the id", (value) => {
    expect(videoId(value)).toBe(VIDEO)
  })

  test.each([
    "",
    "short",
    `${VIDEO}x`,
    "dQw4w9WgXc!",
    "a/b",
    "https://www.youtube.com/watch",
    "https://www.youtube.com/watch?v=short",
    "https://example.com/watch?v=" + VIDEO,
    `https://www.youtube.com/channel/${VIDEO}`,
  ])("%p is refused", (value) => {
    expect(() => videoId(value)).toThrow(/is not a video id/)
  })

  test("a long value is cut in the message", () => {
    expect(() => videoId("A".repeat(300))).toThrow(`${"A".repeat(100)}…`)
  })
})

describe("channelRef", () => {
  test("a channel id", () => {
    expect(channelRef(CHANNEL)).toEqual({ id: CHANNEL })
    expect(channelRef(`https://www.youtube.com/channel/${CHANNEL}`)).toEqual({ id: CHANNEL })
  })

  test("a handle keeps its @", () => {
    expect(channelRef("@some.handle-1_x")).toEqual({ handle: "@some.handle-1_x" })
    expect(channelRef("https://www.youtube.com/@some.handle")).toEqual({ handle: "@some.handle" })
  })

  test.each([
    "",
    "@ab",
    `@${"a".repeat(31)}`,
    "some",
    "UC" + "a".repeat(21),
    `UC${"a".repeat(23)}`,
    "@bad handle",
    "https://www.youtube.com/channel/short",
    "https://example.com/@handle",
    `https://youtu.be/${CHANNEL}`,
    "https://www.youtube.com/@%",
  ])("%p is refused", (value) => {
    expect(() => channelRef(value)).toThrow(/is not a channel/)
  })
})

describe("playlistId", () => {
  test.each(["PLabc123", "UU" + "a".repeat(22), "LL", "RDdQw4w9WgXcQ", "a".repeat(64)])("%s is a playlist id", (id) => {
    expect(playlistId(id)).toBe(id)
  })

  test("an address gives its list=", () => {
    expect(playlistId(`https://www.youtube.com/playlist?list=PLabc123`)).toBe("PLabc123")
    expect(playlistId(`https://www.youtube.com/watch?v=${VIDEO}&list=PLabc123`)).toBe("PLabc123")
  })

  test.each(["", "a", "a".repeat(65), "PL abc", "a/b", "https://www.youtube.com/playlist", "https://x.com/?list=PL1"])(
    "%p is refused",
    (value) => {
      expect(() => playlistId(value)).toThrow(/is not a playlist id/)
    },
  )
})

describe("commentId", () => {
  test.each(["Ugx_abc-1", "Ugx_abc.def-1", "a", "a".repeat(128)])("%s is a comment id", (id) => {
    expect(commentId(id)).toBe(id)
  })

  test.each(["", "a/b", "a b", "a".repeat(129)])("%p is refused", (id) => {
    expect(() => commentId(id)).toThrow(/is not a comment id/)
  })
})

describe("pageToken", () => {
  test.each(["CAUQAA", "a", "A_b-1".repeat(51)])("%s is a page token", (token) => {
    expect(pageToken(token)).toBe(token)
  })

  test.each(["", "a.b", "a b", "a".repeat(257), "a=="])("%p is refused", (token) => {
    expect(() => pageToken(token)).toThrow(/is not a page token/)
  })
})
