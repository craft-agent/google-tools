import { describe, expect, test } from "bun:test"
import { HOSTS, routeUrl } from "../google/routes"
import { GMAIL_ROUTES } from "./routes"
import { GMAIL_COMPOSE_SCOPE, GMAIL_MODIFY_SCOPE, GMAIL_READ_SCOPE, GMAIL_SEND_SCOPE } from "./scopes"

describe("GMAIL_ROUTES", () => {
  test("every route is on the Gmail host", () => {
    for (const route of Object.values(GMAIL_ROUTES)) {
      expect(HOSTS).toContain(route.host)
      expect(route.host).toBe("gmail.googleapis.com")
    }
  })

  test("the mail reads are GETs which the read scope or the modify scope allows", () => {
    const { messages, message, thread, labels, attachment } = GMAIL_ROUTES
    for (const route of [messages, message, thread, labels, attachment]) {
      expect(route.method).toBe("GET")
      expect(route.scopes).toEqual([GMAIL_READ_SCOPE, GMAIL_MODIFY_SCOPE])
    }
  })

  test("the draft reads are GETs which the compose scope allows besides the read ones", () => {
    for (const route of [GMAIL_ROUTES.drafts, GMAIL_ROUTES.draft]) {
      expect(route.method).toBe("GET")
      expect(route.scopes).toEqual([GMAIL_READ_SCOPE, GMAIL_MODIFY_SCOPE, GMAIL_COMPOSE_SCOPE])
    }
  })

  test("the draft writes take the compose or the modify scope, never the send scope", () => {
    const { draftCreate, draftUpdate, draftDelete, draftSend } = GMAIL_ROUTES
    expect([draftCreate, draftUpdate, draftDelete, draftSend].map(({ method }) => method)).toEqual([
      "POST",
      "PUT",
      "DELETE",
      "POST",
    ])
    for (const route of [draftCreate, draftUpdate, draftDelete, draftSend]) {
      expect(route.scopes).toEqual([GMAIL_COMPOSE_SCOPE, GMAIL_MODIFY_SCOPE])
    }
  })

  test("the draft routes' URLs: the upload forms, the id encoded, the send beside the draft ids", () => {
    const base = "https://gmail.googleapis.com"
    const query = { uploadType: "multipart" }
    expect(routeUrl(GMAIL_ROUTES.drafts).toString()).toBe(`${base}/gmail/v1/users/me/drafts`)
    expect(routeUrl(GMAIL_ROUTES.draft, { draft_id: "r-1_a" }).toString()).toBe(
      `${base}/gmail/v1/users/me/drafts/r-1_a`,
    )
    expect(routeUrl(GMAIL_ROUTES.draftCreate, {}, query).toString()).toBe(
      `${base}/upload/gmail/v1/users/me/drafts?uploadType=multipart`,
    )
    expect(routeUrl(GMAIL_ROUTES.draftUpdate, { draft_id: "r-1" }, query).toString()).toBe(
      `${base}/upload/gmail/v1/users/me/drafts/r-1?uploadType=multipart`,
    )
    expect(routeUrl(GMAIL_ROUTES.draftDelete, { draft_id: "r-1" }).toString()).toBe(
      `${base}/gmail/v1/users/me/drafts/r-1`,
    )
    expect(routeUrl(GMAIL_ROUTES.draftSend).toString()).toBe(`${base}/gmail/v1/users/me/drafts/send`)
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
