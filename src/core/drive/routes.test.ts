import { describe, expect, test } from "bun:test"
import { HOSTS, routeUrl } from "../google/routes"
import { DRIVE_ROUTES } from "./routes"
import { DRIVE_FILE_SCOPE, DRIVE_READ_SCOPE } from "./scopes"

const { uploadStart, uploadChunk, ...READ_ROUTES } = DRIVE_ROUTES

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
  })
})
