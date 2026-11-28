import { describe, expect, test } from "bun:test"
import { HOSTS, routeUrl } from "../google/routes"
import { YOUTUBE_ROUTES } from "./routes"
import { YOUTUBE_ANALYTICS_READ_SCOPE, YOUTUBE_READ_SCOPE, YOUTUBE_SCOPE } from "./scopes"

const DATA_HOSTS = ["youtube.googleapis.com", "youtubeanalytics.googleapis.com"]

describe("YOUTUBE_ROUTES", () => {
  test("every route is a GET on a YouTube host", () => {
    for (const route of Object.values(YOUTUBE_ROUTES)) {
      expect(route.method).toBe("GET")
      expect(DATA_HOSTS).toContain(route.host)
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

  test("comments and caption tracks take force-ssl alone", () => {
    for (const name of ["commentThreads", "comments", "captions"] as const) {
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
    expect(routeUrl(YOUTUBE_ROUTES.playlistItems).toString()).toBe(
      "https://youtube.googleapis.com/youtube/v3/playlistItems",
    )
    expect(routeUrl(YOUTUBE_ROUTES.analytics).toString()).toBe("https://youtubeanalytics.googleapis.com/v2/reports")
  })
})
