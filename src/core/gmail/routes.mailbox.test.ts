import { describe, expect, test } from "bun:test"
import { routeUrl } from "../google/routes"
import { GMAIL_ROUTES } from "./routes"
import { GMAIL_MODIFY_SCOPE } from "./scopes"

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me"

/** The routes that change labels and the trash. */
const MODIFY_ROUTES = [
  GMAIL_ROUTES.labelCreate,
  GMAIL_ROUTES.messagesBatchModify,
  GMAIL_ROUTES.threadModify,
  GMAIL_ROUTES.messageTrash,
  GMAIL_ROUTES.messageUntrash,
  GMAIL_ROUTES.threadTrash,
  GMAIL_ROUTES.threadUntrash,
]

describe("the label and trash routes", () => {
  test("every one is a POST that only the modify scope allows", () => {
    for (const route of MODIFY_ROUTES) {
      expect(route.method).toBe("POST")
      expect(route.scopes).toEqual([GMAIL_MODIFY_SCOPE])
    }
  })

  test("listing the labels stays a read route", () => {
    expect(GMAIL_ROUTES.labels.method).toBe("GET")
    expect(GMAIL_ROUTES.labels.scopes).toContain("https://www.googleapis.com/auth/gmail.readonly")
  })

  test("their URLs, with the ids encoded", () => {
    expect(routeUrl(GMAIL_ROUTES.labelCreate).toString()).toBe(`${BASE}/labels`)
    expect(routeUrl(GMAIL_ROUTES.messagesBatchModify).toString()).toBe(`${BASE}/messages/batchModify`)
    expect(routeUrl(GMAIL_ROUTES.threadModify, { thread_id: "t-1" }).toString()).toBe(`${BASE}/threads/t-1/modify`)
    expect(routeUrl(GMAIL_ROUTES.messageTrash, { message_id: "m_1" }).toString()).toBe(`${BASE}/messages/m_1/trash`)
    expect(routeUrl(GMAIL_ROUTES.messageUntrash, { message_id: "m_1" }).toString()).toBe(`${BASE}/messages/m_1/untrash`)
    expect(routeUrl(GMAIL_ROUTES.threadTrash, { thread_id: "t-1" }).toString()).toBe(`${BASE}/threads/t-1/trash`)
    expect(routeUrl(GMAIL_ROUTES.threadUntrash, { thread_id: "t-1" }).toString()).toBe(`${BASE}/threads/t-1/untrash`)
  })
})

describe("what Gmail never offers", () => {
  const routes = Object.values(GMAIL_ROUTES)

  test("no route deletes mail for good: no DELETE of a message or a thread, and no batchDelete", () => {
    const deletes = routes.filter(({ method }) => method === "DELETE").map(({ path }) => path)
    expect(deletes).toEqual(["/gmail/v1/users/me/drafts/{draft_id}"])
    for (const { path } of routes) expect(path).not.toContain("batchDelete")
  })

  test("no route reaches filters, forwarding addresses or auto-forwarding", () => {
    for (const { path } of routes) {
      expect(path).not.toContain("/settings")
      expect(path).not.toContain("filters")
      expect(path).not.toContain("forwardingAddresses")
      expect(path).not.toContain("autoForwarding")
    }
  })

  test("the calls that would do these are not among the routes", () => {
    const known = new Set(routes.map(({ method, path }) => `${method} ${path}`))
    for (const path of [
      "POST /gmail/v1/users/me/messages/batchDelete",
      "DELETE /gmail/v1/users/me/messages/{message_id}",
      "DELETE /gmail/v1/users/me/threads/{thread_id}",
      "POST /gmail/v1/users/me/settings/filters",
      "POST /gmail/v1/users/me/settings/forwardingAddresses",
      "PUT /gmail/v1/users/me/settings/autoForwarding",
    ]) {
      expect([path, known.has(path)]).toEqual([path, false])
    }
  })
})
