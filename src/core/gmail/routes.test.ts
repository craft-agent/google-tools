import { describe, expect, test } from "bun:test"
import { HOSTS, routeUrl } from "../google/routes"
import { GMAIL_ROUTES } from "./routes"
import { GMAIL_MODIFY_SCOPE, GMAIL_READ_SCOPE } from "./scopes"

describe("GMAIL_ROUTES", () => {
  test("every route is a GET on the Gmail host, which any read scope or the modify scope allows", () => {
    for (const route of Object.values(GMAIL_ROUTES)) {
      expect(route.method).toBe("GET")
      expect(HOSTS).toContain(route.host)
      expect(route.host).toBe("gmail.googleapis.com")
      expect(route.scopes).toEqual([GMAIL_READ_SCOPE, GMAIL_MODIFY_SCOPE])
    }
  })

  test("the hosts stay sorted", () => {
    expect([...HOSTS]).toEqual([...HOSTS].sort())
  })

  test("the URLs encode the ids", () => {
    const base = "https://gmail.googleapis.com/gmail/v1/users/me"
    expect(routeUrl(GMAIL_ROUTES.messages).toString()).toBe(`${base}/messages`)
    expect(routeUrl(GMAIL_ROUTES.message, { message_id: "a_B-1" }).toString()).toBe(`${base}/messages/a_B-1`)
    expect(routeUrl(GMAIL_ROUTES.thread, { thread_id: "a_B-1" }).toString()).toBe(`${base}/threads/a_B-1`)
    expect(routeUrl(GMAIL_ROUTES.labels).toString()).toBe(`${base}/labels`)
    expect(routeUrl(GMAIL_ROUTES.attachment, { message_id: "m", attachment_id: "a b" }).toString()).toBe(
      `${base}/messages/m/attachments/a%20b`,
    )
  })

  test("an id with a slash or a dot segment cannot be a path parameter", () => {
    expect(() => routeUrl(GMAIL_ROUTES.message, { message_id: "a/b" })).toThrow()
    expect(() => routeUrl(GMAIL_ROUTES.message, { message_id: ".." })).toThrow()
  })
})
