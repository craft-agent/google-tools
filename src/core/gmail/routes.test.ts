import { describe, expect, test } from "bun:test"
import { HOSTS, routeUrl } from "../google/routes"
import { GMAIL_ROUTES } from "./routes"
import { GMAIL_COMPOSE_SCOPE, GMAIL_MODIFY_SCOPE, GMAIL_READ_SCOPE, GMAIL_SEND_SCOPE } from "./scopes"

describe("GMAIL_ROUTES", () => {
  test("every route but send is a GET on the Gmail host, which any read scope or the modify scope allows", () => {
    const { send: _send, ...reads } = GMAIL_ROUTES
    for (const route of Object.values(reads)) {
      expect(route.method).toBe("GET")
      expect(HOSTS).toContain(route.host)
      expect(route.host).toBe("gmail.googleapis.com")
      expect(route.scopes).toEqual([GMAIL_READ_SCOPE, GMAIL_MODIFY_SCOPE])
    }
  })

  test("send is the media upload POST on the Gmail host, which the send, compose or modify scope allows", () => {
    expect(GMAIL_ROUTES.send).toMatchObject({ method: "POST", host: "gmail.googleapis.com" })
    expect(GMAIL_ROUTES.send.scopes).toEqual([GMAIL_SEND_SCOPE, GMAIL_COMPOSE_SCOPE, GMAIL_MODIFY_SCOPE])
    expect(routeUrl(GMAIL_ROUTES.send, {}, { uploadType: "multipart" }).toString()).toBe(
      "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart",
    )
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
