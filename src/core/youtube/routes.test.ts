import { describe, expect, test } from "bun:test"
import { HOSTS, routeUrl } from "../google/routes"
import { YOUTUBE_ROUTES } from "./routes"
import { YOUTUBE_ANALYTICS_READ_SCOPE, YOUTUBE_READ_SCOPE, YOUTUBE_SCOPE } from "./scopes"

const DATA_HOSTS = ["youtube.googleapis.com", "youtubeanalytics.googleapis.com"]
const UPLOAD_HOST = "www.googleapis.com"

describe("YOUTUBE_ROUTES", () => {
  test("every route is a GET on a YouTube host, but the writes", () => {
    const writes: Record<string, "PUT" | "POST" | "DELETE"> = {
      videosUpdate: "PUT",
      thumbnailsSet: "POST",
      videosInsert: "POST",
      videosInsertChunk: "PUT",
      captionsInsert: "POST",
      captionsUpdateMedia: "PUT",
      captionsUpdate: "PUT",
      commentsInsert: "POST",
      commentsModerate: "POST",
      playlistsInsert: "POST",
      playlistsUpdate: "PUT",
      playlistItemsInsert: "POST",
      playlistItemsUpdate: "PUT",
      playlistItemsDelete: "DELETE",
      channelsUpdate: "PUT",
      watermarksSet: "POST",
      watermarksUnset: "POST",
    }
    const uploads = [
      "thumbnailsSet",
      "videosInsert",
      "videosInsertChunk",
      "captionsInsert",
      "captionsUpdateMedia",
      "watermarksSet",
    ]
    for (const [name, route] of Object.entries(YOUTUBE_ROUTES)) {
      expect(route.method).toBe(writes[name] ?? "GET")
      expect(uploads.includes(name) ? [UPLOAD_HOST] : DATA_HOSTS).toContain(route.host)
      expect(HOSTS).toContain(route.host)
    }
  })

  test("the Data API routes sit under /youtube/v3/", () => {
    for (const route of Object.values(YOUTUBE_ROUTES).filter(({ host }) => host === "youtube.googleapis.com")) {
      expect(route.path.startsWith("/youtube/v3/")).toBe(true)
    }
  })

  test("public data takes youtube.readonly or force-ssl, narrowest first", () => {
    for (const name of ["search", "videos", "channels", "playlists", "playlistItems"] as const) {
      expect(YOUTUBE_ROUTES[name].scopes).toEqual([YOUTUBE_READ_SCOPE, YOUTUBE_SCOPE])
    }
  })

  test("comments, caption tracks, the video update and the uploads take force-ssl alone", () => {
    const names = ["commentThreads", "comments", "captions", "videosUpdate", "thumbnailsSet"] as const
    const more = [
      "videosInsert",
      "videosInsertChunk",
      "captionsInsert",
      "captionsUpdateMedia",
      "captionsUpdate",
      "commentsInsert",
      "commentsModerate",
      "playlistsInsert",
      "playlistsUpdate",
      "playlistItemsInsert",
      "playlistItemsUpdate",
      "playlistItemsDelete",
      "channelsUpdate",
      "watermarksSet",
      "watermarksUnset",
    ] as const
    for (const name of [...names, ...more]) {
      expect(YOUTUBE_ROUTES[name].scopes).toEqual([YOUTUBE_SCOPE])
    }
  })

  test("analytics takes the analytics scope, then youtube.readonly", () => {
    expect(YOUTUBE_ROUTES.analytics.scopes).toEqual([YOUTUBE_ANALYTICS_READ_SCOPE, YOUTUBE_READ_SCOPE])
  })

  test("the URLs, with the query after the path", () => {
    expect(routeUrl(YOUTUBE_ROUTES.videos, {}, { part: "snippet", id: "abc" }).toString()).toBe(
      "https://youtube.googleapis.com/youtube/v3/videos?part=snippet&id=abc",
    )
    expect(routeUrl(YOUTUBE_ROUTES.videosUpdate, {}, { part: "snippet,status" }).toString()).toBe(
      "https://youtube.googleapis.com/youtube/v3/videos?part=snippet%2Cstatus",
    )
    expect(routeUrl(YOUTUBE_ROUTES.thumbnailsSet, {}, { videoId: "abc", uploadType: "media" }).toString()).toBe(
      "https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=abc&uploadType=media",
    )
    expect(
      routeUrl(YOUTUBE_ROUTES.videosInsert, {}, { uploadType: "resumable", part: "snippet,status" }).toString(),
    ).toBe("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet%2Cstatus")
    expect(routeUrl(YOUTUBE_ROUTES.videosInsertChunk).toString()).toBe(
      "https://www.googleapis.com/upload/youtube/v3/videos",
    )
    expect(routeUrl(YOUTUBE_ROUTES.captionsInsert, {}, { uploadType: "multipart", part: "snippet" }).toString()).toBe(
      "https://www.googleapis.com/upload/youtube/v3/captions?uploadType=multipart&part=snippet",
    )
    expect(
      routeUrl(YOUTUBE_ROUTES.captionsUpdateMedia, {}, { uploadType: "multipart", part: "snippet" }).toString(),
    ).toBe("https://www.googleapis.com/upload/youtube/v3/captions?uploadType=multipart&part=snippet")
    expect(routeUrl(YOUTUBE_ROUTES.captionsUpdate, {}, { part: "snippet" }).toString()).toBe(
      "https://youtube.googleapis.com/youtube/v3/captions?part=snippet",
    )
    expect(routeUrl(YOUTUBE_ROUTES.commentsInsert, {}, { part: "snippet" }).toString()).toBe(
      "https://youtube.googleapis.com/youtube/v3/comments?part=snippet",
    )
    expect(
      routeUrl(
        YOUTUBE_ROUTES.commentsModerate,
        {},
        { id: "a,b", moderationStatus: "rejected", banAuthor: true },
      ).toString(),
    ).toBe(
      "https://youtube.googleapis.com/youtube/v3/comments/setModerationStatus?id=a%2Cb&moderationStatus=rejected&banAuthor=true",
    )
    expect(routeUrl(YOUTUBE_ROUTES.playlistsUpdate, {}, { part: "snippet,status" }).toString()).toBe(
      "https://youtube.googleapis.com/youtube/v3/playlists?part=snippet%2Cstatus",
    )
    expect(routeUrl(YOUTUBE_ROUTES.playlistItemsDelete, {}, { id: "item" }).toString()).toBe(
      "https://youtube.googleapis.com/youtube/v3/playlistItems?id=item",
    )
    expect(routeUrl(YOUTUBE_ROUTES.channelsUpdate, {}, { part: "brandingSettings" }).toString()).toBe(
      "https://youtube.googleapis.com/youtube/v3/channels?part=brandingSettings",
    )
    expect(routeUrl(YOUTUBE_ROUTES.watermarksSet, {}, { channelId: "UCabc", uploadType: "multipart" }).toString()).toBe(
      "https://www.googleapis.com/upload/youtube/v3/watermarks/set?channelId=UCabc&uploadType=multipart",
    )
    expect(routeUrl(YOUTUBE_ROUTES.watermarksUnset, {}, { channelId: "UCabc" }).toString()).toBe(
      "https://youtube.googleapis.com/youtube/v3/watermarks/unset?channelId=UCabc",
    )
    expect(routeUrl(YOUTUBE_ROUTES.playlistItems).toString()).toBe(
      "https://youtube.googleapis.com/youtube/v3/playlistItems",
    )
    expect(routeUrl(YOUTUBE_ROUTES.analytics).toString()).toBe("https://youtubeanalytics.googleapis.com/v2/reports")
  })
})
