import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import { GoogleClient } from "./client"
import { DRIVE_SCOPE, TOKEN_URL, VARIABLE, makeLabel, storeCredential, toolError } from "./client.fixtures"
import { FAKE_ACCESS_TOKEN, fakeGoogle, tokenReply, type FakeHandler } from "./fake-google.testing"
import type { LabelPaths } from "./labels"
import { MASK } from "./mask"
import { EMAIL_SCOPE, type Route } from "./routes"
import { clearTokenCache } from "./token"

const EXPORT_ROUTE: Route = {
  method: "GET",
  host: "docs.google.com",
  path: "/files/{id}/export",
  scopes: [EMAIL_SCOPE],
}
const EXPORT_URL = "https://docs.google.com/files/abc/export"
const PDF = { "content-type": "application/pdf" }
const BODY = new TextEncoder().encode("%PDF-made-up")
const MIB = 1024 * 1024

const tokenHandler: FakeHandler = { method: "POST", url: TOKEN_URL, reply: { json: tokenReply() } }
const exportReply = (reply: FakeHandler["reply"]): FakeHandler => ({ method: "GET", url: EXPORT_URL, reply })

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

function clientOver(handlers: FakeHandler[], options: { timeoutMs?: number; signal?: AbortSignal } = {}) {
  const google = fakeGoogle(handlers)
  const client = new GoogleClient({ paths, variable: VARIABLE, env: {}, fetch: google.fetch, ...options })
  const chunks: Uint8Array[] = []
  const download = (maxBytes = MIB, route: Route = EXPORT_ROUTE) =>
    client.download(route, {
      params: { id: "abc" },
      query: { format: "pdf", skip: undefined },
      maxBytes,
      accept: "application/pdf",
      write: async (chunk) => void chunks.push(chunk),
    })
  return { download, chunks, requests: google.requests }
}

describe("GoogleClient.download", () => {
  test("streams the body to write and returns its size and media type", async () => {
    const { download, chunks } = clientOver([
      tokenHandler,
      exportReply({ bytes: BODY, headers: { "content-type": "Application/PDF; charset=binary" } }),
    ])
    expect(await download()).toEqual({ bytes: BODY.byteLength, contentType: "application/pdf" })
    expect(Buffer.concat(chunks).equals(BODY)).toBe(true)
  })

  test("sends the bearer token, the accepted type and the query, with no redirect followed", async () => {
    const seen: (RequestRedirect | undefined)[] = []
    const google = fakeGoogle([tokenHandler, exportReply({ bytes: BODY, headers: PDF })])
    const client = new GoogleClient({
      paths,
      variable: VARIABLE,
      env: {},
      fetch: (url, init) => {
        seen.push(init.redirect)
        return google.fetch(url, init)
      },
    })
    await client.download(EXPORT_ROUTE, {
      params: { id: "abc" },
      query: { format: "pdf", skip: undefined },
      maxBytes: MIB,
      accept: "application/pdf",
      write: async () => {},
    })
    const call = google.requests.at(-1)
    expect(call?.headers.authorization).toBe(`Bearer ${FAKE_ACCESS_TOKEN}`)
    expect(call?.headers.accept).toBe("application/pdf")
    expect(call?.url.search).toBe("?format=pdf")
    expect(seen).toEqual(["manual", "manual"])
  })

  test("a body of exactly maxBytes is taken, one byte more is invalid_argument", async () => {
    const exact = clientOver([tokenHandler, exportReply({ bytes: new Uint8Array(MIB), headers: PDF })])
    expect((await exact.download()).bytes).toBe(MIB)
    clearTokenCache()
    const over = clientOver([tokenHandler, exportReply({ bytes: new Uint8Array(MIB + 1), headers: PDF })])
    const error = await toolError(over.download())
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe("The export is over 1 MiB; snapshot a smaller range.")
    const written = over.chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
    expect(written).toBeLessThanOrEqual(MIB)
  })

  test("a body over maxBytes says what limitMessage says, when it is given", async () => {
    const google = fakeGoogle([tokenHandler, exportReply({ bytes: new Uint8Array(MIB + 1), headers: PDF })])
    const client = new GoogleClient({ paths, variable: VARIABLE, env: {}, fetch: google.fetch })
    const over = client.download(EXPORT_ROUTE, {
      params: { id: "abc" },
      maxBytes: MIB,
      limitMessage: "The file is over 1 MiB, which download does not save.",
      accept: "application/pdf",
      write: async () => {},
    })
    const error = await toolError(over)
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe("The file is over 1 MiB, which download does not save.")
  })

  test("a content type other than the accepted one is upstream_error naming the type only", async () => {
    const { download, chunks } = clientOver([
      tokenHandler,
      exportReply({ text: "<html>sign in</html>", headers: { "content-type": "text/html; charset=utf-8" } }),
    ])
    const error = await toolError(download())
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("Google answered the export with text/html instead of application/pdf.")
    expect(chunks).toEqual([])
  })

  test("a body with no content type is upstream_error", async () => {
    const { download } = clientOver([tokenHandler, exportReply({ bytes: BODY })])
    expect((await toolError(download())).message).toBe(
      "Google answered the export with no content type instead of application/pdf.",
    )
  })

  test("a redirect of a route with no handoff is not followed", async () => {
    const { download, requests } = clientOver([
      tokenHandler,
      exportReply({ status: 302, headers: { location: "https://elsewhere.test/" } }),
    ])
    const error = await toolError(download())
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("Google answered with a redirect, which is not followed; nothing was fetched from it.")
    expect(requests.filter((request) => request.url.host !== "oauth2.googleapis.com")).toHaveLength(1)
  })

  test("a failure status is mapped as for any call, and its body is masked", async () => {
    const { download } = clientOver([
      tokenHandler,
      exportReply({
        status: 404,
        json: { error: { message: `no file for ${FAKE_ACCESS_TOKEN}`, status: "NOT_FOUND" } },
      }),
    ])
    const error = await toolError(download())
    expect(error.code).toBe("not_found")
    expect(error.message).toBe(`Google: no file for ${MASK}`)
  })

  test("a failure with an HTML body says only its status", async () => {
    const { download } = clientOver([tokenHandler, exportReply({ status: 500, text: "<html>oops</html>" })])
    const error = await toolError(download())
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("Google: HTTP 500")
  })
})

describe("GoogleClient.download access", () => {
  test("a label without the route's scopes fails as unauthenticated before any request", async () => {
    const { download, requests } = clientOver([tokenHandler, exportReply({ bytes: BODY, headers: PDF })])
    const error = await toolError(download(MIB, { ...EXPORT_ROUTE, scopes: [DRIVE_SCOPE] }))
    expect(error.code).toBe("unauthenticated")
    expect(requests).toHaveLength(0)
  })

  test("a 401 forgets the token and retries once, writing only the second answer", async () => {
    let issued = 0
    const { download, chunks, requests } = clientOver([
      {
        method: "POST",
        url: TOKEN_URL,
        reply: () => ({ json: tokenReply({ access_token: `ya29.token-number-${++issued}-0000000000` }) }),
      },
      exportReply((request) =>
        request.headers.authorization === "Bearer ya29.token-number-2-0000000000"
          ? { bytes: BODY, headers: PDF }
          : { status: 401, json: { error: { message: "expired" } } },
      ),
    ])
    expect((await download()).bytes).toBe(BODY.byteLength)
    expect(chunks).toHaveLength(1)
    expect(requests.map((request) => request.url.host)).toEqual([
      "oauth2.googleapis.com",
      "docs.google.com",
      "oauth2.googleapis.com",
      "docs.google.com",
    ])
  })

  test("a second 401 fails as unauthenticated", async () => {
    const { download, requests } = clientOver([
      tokenHandler,
      exportReply({ status: 401, json: { error: { message: "no" } } }),
    ])
    expect((await toolError(download())).code).toBe("unauthenticated")
    expect(requests.filter((request) => request.url.host === "docs.google.com")).toHaveLength(2)
  })
})

describe("GoogleClient.download time limit and failures to write", () => {
  test("an export that outlasts the time limit is upstream_error", async () => {
    const { download } = clientOver([tokenHandler, exportReply(() => new Promise(() => {}))], { timeoutMs: 30 })
    expect((await toolError(download())).message).toBe("Google did not answer within 0.03 s")
  })

  test("a download's own time limit replaces the client's", async () => {
    const google = fakeGoogle([tokenHandler, exportReply(() => new Promise(() => {}))])
    const client = new GoogleClient({ paths, variable: VARIABLE, env: {}, fetch: google.fetch, timeoutMs: 60_000 })
    const pending = client.download(EXPORT_ROUTE, {
      params: { id: "abc" },
      maxBytes: MIB,
      accept: "application/pdf",
      timeoutMs: 20,
      write: async () => {},
    })
    expect((await toolError(pending)).message).toBe("Google did not answer within 0.02 s")
  })

  test("the caller's signal cancels the call", async () => {
    const controller = new AbortController()
    const { download } = clientOver([tokenHandler, exportReply(() => new Promise(() => {}))], {
      signal: controller.signal,
    })
    const pending = toolError(download())
    setTimeout(() => controller.abort(), 30)
    expect((await pending).message).toBe("The call was cancelled.")
  })

  test("an error write throws passes as it is", async () => {
    const google = fakeGoogle([tokenHandler, exportReply({ bytes: BODY, headers: PDF })])
    const client = new GoogleClient({ paths, variable: VARIABLE, env: {}, fetch: google.fetch })
    const failure = client.download(EXPORT_ROUTE, {
      params: { id: "abc" },
      maxBytes: MIB,
      accept: "application/pdf",
      write: async () => {
        throw new Error("No space left on device")
      },
    })
    await expect(failure).rejects.toThrow("No space left on device")
  })
})
