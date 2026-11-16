import { describe, expect, test } from "bun:test"
import { HOSTS, routeUrl } from "../google/routes"
import { DRIVE_ROUTES } from "./routes"
import { DRIVE_FILE_SCOPE, DRIVE_READ_SCOPE } from "./scopes"

const { uploadStart, uploadChunk, create, copy, update, ...READ_ROUTES } = DRIVE_ROUTES

/** What a Drive tool never does, as the method and path that does it: no permanent deletion, no change of sharing, no revisions, no shared drive made. */
const NEVER_OFFERED = [
  { what: "files.delete and emptyTrash: deleting for good", matches: (method: string) => method === "DELETE" },
  {
    what: "a write to permissions: changing who can reach a file",
    matches: (method: string, path: string) => method !== "GET" && path.includes("/permissions"),
  },
  { what: "revisions", matches: (_method: string, path: string) => path.includes("/revisions") },
  {
    what: "a write to drives: creating or changing a shared drive",
    matches: (method: string, path: string) => method !== "GET" && path.startsWith("/drive/v3/drives"),
  },
]

describe("DRIVE_ROUTES", () => {
  test("every read route is a GET on the Drive host which only the drive.readonly scope allows", () => {
    for (const route of Object.values(READ_ROUTES)) {
      expect(HOSTS).toContain(route.host)
      expect(route.host).toBe("www.googleapis.com")
      expect(route.method).toBe("GET")
      expect(route.scopes).toEqual([DRIVE_READ_SCOPE])
    }
  })

  test("the upload routes start a session with a POST and send its chunks with a PUT, which only drive.file allows", () => {
    expect(uploadStart).toMatchObject({ method: "POST", host: "www.googleapis.com", scopes: [DRIVE_FILE_SCOPE] })
    expect(uploadChunk).toMatchObject({ method: "PUT", host: "www.googleapis.com", scopes: [DRIVE_FILE_SCOPE] })
    expect(uploadChunk.path).toBe(uploadStart.path)
    expect(routeUrl(uploadStart, {}, { uploadType: "resumable" }).toString()).toBe(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
    )
  })

  test("the metadata writes create, copy and update are a POST, a POST and a PATCH, which only drive.file allows", () => {
    expect(create).toMatchObject({ method: "POST", host: "www.googleapis.com", scopes: [DRIVE_FILE_SCOPE] })
    expect(copy).toMatchObject({ method: "POST", host: "www.googleapis.com", scopes: [DRIVE_FILE_SCOPE] })
    expect(update).toMatchObject({ method: "PATCH", host: "www.googleapis.com", scopes: [DRIVE_FILE_SCOPE] })
    expect(routeUrl(create).toString()).toBe("https://www.googleapis.com/drive/v3/files")
    expect(routeUrl(copy, { file_id: "a_B-1" }).toString()).toBe("https://www.googleapis.com/drive/v3/files/a_B-1/copy")
    expect(routeUrl(update, { file_id: "a_B-1" }).toString()).toBe("https://www.googleapis.com/drive/v3/files/a_B-1")
  })

  test.each(NEVER_OFFERED)("never offers $what", ({ matches }) => {
    const offered = Object.entries(DRIVE_ROUTES).filter(([, route]) => matches(route.method, route.path))
    expect(offered.map(([name]) => name)).toEqual([])
  })

  test("the only routes that write are the upload's, create, copy and update, none of them a DELETE", () => {
    const writing = Object.entries(DRIVE_ROUTES)
      .filter(([, route]) => route.method !== "GET")
      .map(([name]) => name)
      .sort()
    expect(writing).toEqual(["copy", "create", "update", "uploadChunk", "uploadStart"])
  })

  test("the URLs, the ids encoded", () => {
    const base = "https://www.googleapis.com/drive/v3"
    expect(routeUrl(DRIVE_ROUTES.files).toString()).toBe(`${base}/files`)
    expect(routeUrl(DRIVE_ROUTES.file, { file_id: "a_B-1" }).toString()).toBe(`${base}/files/a_B-1`)
    expect(routeUrl(DRIVE_ROUTES.media, { file_id: "a_B-1" }, { alt: "media" }).toString()).toBe(
      `${base}/files/a_B-1?alt=media`,
    )
    expect(routeUrl(DRIVE_ROUTES.export, { file_id: "a_B-1" }).toString()).toBe(`${base}/files/a_B-1/export`)
    expect(routeUrl(DRIVE_ROUTES.permissions, { file_id: "a_B-1" }).toString()).toBe(`${base}/files/a_B-1/permissions`)
    expect(routeUrl(DRIVE_ROUTES.drives).toString()).toBe(`${base}/drives`)
  })

  test("an id with a slash or a dot segment cannot be a path parameter", () => {
    expect(() => routeUrl(DRIVE_ROUTES.file, { file_id: "a/b" })).toThrow()
    expect(() => routeUrl(DRIVE_ROUTES.export, { file_id: ".." })).toThrow()
    expect(() => routeUrl(DRIVE_ROUTES.copy, { file_id: "a/b" })).toThrow()
  })
})
