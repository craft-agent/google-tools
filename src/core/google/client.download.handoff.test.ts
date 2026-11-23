import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import type { ErrorCode } from "../errors"
import { GoogleClient } from "./client"
import { TOKEN_URL, VARIABLE, makeLabel, storeCredential, toolError } from "./client.fixtures"
import { FAKE_ACCESS_TOKEN, fakeGoogle, tokenReply, type FakeHandler } from "./fake-google.testing"
import type { LabelPaths } from "./labels"
import { MASK } from "./mask"
import { EMAIL_SCOPE, type Route } from "./routes"
import { clearTokenCache } from "./token"

const HANDOFF_ROUTE: Route = {
  method: "GET",
  host: "docs.google.com",
  path: "/files/{id}/export",
  scopes: [EMAIL_SCOPE],
  handoff: { host: /^doc-[0-9a-z-]+-sheets\.googleusercontent\.com$/, pathPrefix: "/export/" },
}
const EXPORT_URL = "https://docs.google.com/files/abc/export"
const HANDOFF_URL = "https://doc-1-2-sheets.googleusercontent.com/export/opaquea/opaqueb/123"
const SIGNED_QUERY = "?sig=madeupsignature&ttl=300"
const SIGNED_URL = `${HANDOFF_URL}${SIGNED_QUERY}`
const REFUSED = "Google handed the export to an address this call does not accept; nothing was fetched from it."
const PDF = { "content-type": "application/pdf" }
const BODY = new TextEncoder().encode("%PDF-made-up")
const MIB = 1024 * 1024

const tokenHandler: FakeHandler = { method: "POST", url: TOKEN_URL, reply: { json: tokenReply() } }
const handsOffTo = (location?: string): FakeHandler => ({
  method: "GET",
  url: EXPORT_URL,
  reply: { status: 307, headers: location === undefined ? {} : { location } },
})
const handoffReply = (reply: FakeHandler["reply"]): FakeHandler => ({ method: "GET", url: HANDOFF_URL, reply })

let stateDir: string
let paths: LabelPaths

beforeEach(async () => {
  clearTokenCache()
  ;({ stateDir, paths } = await makeLabel())
  await storeCredential(paths)
})

afterEach(async () => {
  await rm(stateDir, { recursive: true, force: true })
})

function clientOver(handlers: FakeHandler[], options: { timeoutMs?: number } = {}) {
  const google = fakeGoogle(handlers)
  const inits: RequestInit[] = []
  const client = new GoogleClient({
    paths,
    variable: VARIABLE,
    env: {},
    fetch: (url, init) => {
      inits.push(init)
      return google.fetch(url, init)
    },
    ...options,
  })
  const chunks: Uint8Array[] = []
  const download = (maxBytes = MIB) =>
    client.download(HANDOFF_ROUTE, {
      params: { id: "abc" },
      query: { format: "pdf" },
      maxBytes,
      accept: "application/pdf",
      write: async (chunk) => void chunks.push(chunk),
    })
  /** What was sent to Google other than the token refresh. */
  const calls = () => google.requests.filter((request) => request.url.host !== "oauth2.googleapis.com")
  return { download, chunks, calls, inits, requests: google.requests }
}

describe("GoogleClient.download handoff followed", () => {
  test("fetches the handed-off address, sends it only Accept and saves what it serves", async () => {
    const { download, chunks, calls, inits } = clientOver([
      tokenHandler,
      handsOffTo(SIGNED_URL),
      handoffReply({ bytes: BODY, headers: PDF }),
    ])

    expect(await download()).toEqual({ bytes: BODY.byteLength, contentType: "application/pdf" })

    expect(Buffer.concat(chunks).equals(BODY)).toBe(true)
    const [first, second] = calls()
    expect(first?.headers.authorization).toBe(`Bearer ${FAKE_ACCESS_TOKEN}`)
    expect(second?.url.href).toBe(SIGNED_URL)
    expect(second?.method).toBe("GET")
    expect(second?.headers).toEqual({ accept: "application/pdf" })
    expect(second?.body).toBeUndefined()
    const handoffInit = inits.at(-1)
    expect(handoffInit?.redirect).toBe("manual")
    expect(handoffInit?.credentials).toBeUndefined()
    expect(handoffInit?.body).toBeUndefined()
  })

  test("a wrong content type from the handoff is upstream_error naming the type only", async () => {
    const { download, chunks } = clientOver([
      tokenHandler,
      handsOffTo(SIGNED_URL),
      handoffReply({ text: "<html>sign in</html>", headers: { "content-type": "text/html" } }),
    ])
    const error = await toolError(download())
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("Google answered the export with text/html instead of application/pdf.")
    expect(chunks).toEqual([])
  })

  test("a body over maxBytes from the handoff is invalid_argument", async () => {
    const { download } = clientOver([
      tokenHandler,
      handsOffTo(SIGNED_URL),
      handoffReply({ bytes: new Uint8Array(MIB + 1), headers: PDF }),
    ])
    const error = await toolError(download())
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe("The export is over 1 MiB; snapshot a smaller range.")
  })
})

describe("GoogleClient.download handoff refused", () => {
  test.each([
    ["a host that does not match", "https://elsewhere.test/export/opaquea?sig=madeupsignature"],
    ["a host the pattern only ends with", HANDOFF_URL.replace("doc-1-2-sheets.", "evil.doc-1-2-sheets.")],
    ["http", SIGNED_URL.replace("https:", "http:")],
    ["user info", SIGNED_URL.replace("https://", "https://user:pass@")],
    ["a port", SIGNED_URL.replace(".com/", ".com:8443/")],
    ["a fragment", `${SIGNED_URL}#frag`],
    ["a path outside the prefix", SIGNED_URL.replace("/export/", "/other/")],
    ["a relative address", `/export/opaquea${SIGNED_QUERY}`],
    ["an address that is no URL", "not a url"],
  ])("a handoff to %s is upstream_error and nothing is fetched from it", async (_name, location) => {
    const { download, calls } = clientOver([tokenHandler, handsOffTo(location)])

    const error = await toolError(download())

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(REFUSED)
    expect(calls()).toHaveLength(1)
  })

  test("a redirect with no Location is upstream_error and nothing is fetched", async () => {
    const { download, calls } = clientOver([tokenHandler, handsOffTo()])
    expect((await toolError(download())).message).toBe(REFUSED)
    expect(calls()).toHaveLength(1)
  })

  test("a redirect from the handoff address is refused, after two requests", async () => {
    const { download, calls } = clientOver([
      tokenHandler,
      handsOffTo(SIGNED_URL),
      handoffReply({ status: 302, headers: { location: "https://elsewhere.test/" } }),
    ])
    const error = await toolError(download())
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("Google's download address answered with another redirect, which is not followed.")
    expect(calls().map((request) => request.url.host)).toEqual([
      "docs.google.com",
      "doc-1-2-sheets.googleusercontent.com",
    ])
  })
})

describe("GoogleClient.download handoff failures", () => {
  test("a 401 from the handoff is upstream_error, never a token retry", async () => {
    const { download, calls, requests } = clientOver([
      tokenHandler,
      handsOffTo(SIGNED_URL),
      handoffReply({ status: 401, json: { error: { message: "no" } } }),
    ])
    const error = await toolError(download())
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("Google: no")
    expect(calls()).toHaveLength(2)
    expect(requests.filter((request) => request.url.host === "oauth2.googleapis.com")).toHaveLength(1)
  })

  test.each<[number, ErrorCode, string]>([
    [403, "forbidden", "PERMISSION_DENIED"],
    [404, "not_found", "NOT_FOUND"],
  ])("a %s from the handoff is mapped and its masked body hides the address", async (status, code, googleStatus) => {
    const { download } = clientOver([
      tokenHandler,
      handsOffTo(SIGNED_URL),
      handoffReply({
        status,
        json: {
          error: { message: `no ${SIGNED_URL} nor ${SIGNED_QUERY} for ${FAKE_ACCESS_TOKEN}`, status: googleStatus },
        },
      }),
    ])
    const error = await toolError(download())
    expect(error.code).toBe(code)
    expect(error.message).toBe(`Google: no ${MASK} nor ${MASK} for ${MASK}`)
  })

  test("a network failure on the handoff does not show the address", async () => {
    const { download } = clientOver([
      tokenHandler,
      handsOffTo(SIGNED_URL),
      handoffReply(() => {
        throw new Error(`connect failed for ${SIGNED_URL}`)
      }),
    ])
    const error = await toolError(download())
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Google could not be reached: connect failed for ${MASK}`)
  })

  test("the time limit covers both hops", async () => {
    const { download } = clientOver([tokenHandler, handsOffTo(SIGNED_URL), handoffReply(() => new Promise(() => {}))], {
      timeoutMs: 30,
    })
    expect((await toolError(download())).message).toBe("Google did not answer within 0.03 s")
  })
})
