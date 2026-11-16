import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import { GoogleClient } from "./client"
import { TOKEN_URL, VARIABLE, makeLabel, storeCredential, toolError } from "./client.fixtures"
import { FAKE_ACCESS_TOKEN, fakeGoogle, tokenReply, type FakeHandler } from "./fake-google.testing"
import type { LabelPaths } from "./labels"
import { MASK } from "./mask"
import { CHUNK_ALIGNMENT_BYTES } from "./resumable"
import type { Route } from "./routes"
import { clearTokenCache } from "./token"

const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files"
const START: Route = { method: "POST", host: "www.googleapis.com", path: "/upload/drive/v3/files", scopes: [] }
const CHUNK: Route = { ...START, method: "PUT" }

const UPLOAD_ID = "madeUpUploadId-AAAA0123456789"
const SESSION_URI = `${UPLOAD_URL}?uploadType=resumable&upload_id=${UPLOAD_ID}`

const OPTIONS = {
  query: { uploadType: "resumable", fields: "id" },
  metadata: { name: "report.txt", parents: ["folder1"] },
  contentType: "text/plain",
  size: 300_000,
}

const tokenHandler: FakeHandler = { method: "POST", url: TOKEN_URL, reply: { json: tokenReply() } }

/** The handler that opens a session, answering with `location` (the made-up session address by default). */
const startHandler = (location: string | null = SESSION_URI): FakeHandler => ({
  method: "POST",
  url: UPLOAD_URL,
  reply: { headers: location === null ? {} : { location } },
})

/** The handler for the session's chunks. */
const chunkHandler = (reply: FakeHandler["reply"], once = false): FakeHandler => ({
  method: "PUT",
  url: UPLOAD_URL,
  reply,
  once,
})

const FIRST_CHUNK = new Uint8Array(CHUNK_ALIGNMENT_BYTES).fill(1)
const LAST_CHUNK = new Uint8Array(OPTIONS.size - CHUNK_ALIGNMENT_BYTES).fill(2)

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

function clientOver(handlers: FakeHandler[]) {
  const google = fakeGoogle([tokenHandler, ...handlers])
  const client = new GoogleClient({ paths, variable: VARIABLE, env: {}, fetch: google.fetch })
  return {
    client,
    /** What the fake received at the upload route, the token refresh left out. */
    requests: () => google.requests.filter((request) => request.url.href.startsWith(UPLOAD_URL)),
  }
}

describe("GoogleClient.startResumable", () => {
  test("opens a session with the file's metadata as JSON, its type and size, and the bearer token", async () => {
    const { client, requests } = clientOver([startHandler()])
    await client.startResumable(START, CHUNK, OPTIONS)
    const [call] = requests()
    expect(call?.method).toBe("POST")
    expect(call?.url.searchParams.get("uploadType")).toBe("resumable")
    expect(call?.json).toEqual(OPTIONS.metadata)
    expect(call?.headers["x-upload-content-type"]).toBe("text/plain")
    expect(call?.headers["x-upload-content-length"]).toBe("300000")
    expect(call?.headers.authorization).toBe(`Bearer ${FAKE_ACCESS_TOKEN}`)
  })

  test("a refused start maps as any call does and gives no session", async () => {
    const { client, requests } = clientOver([
      { method: "POST", url: UPLOAD_URL, reply: { status: 403, json: { error: { status: "PERMISSION_DENIED" } } } },
    ])
    expect((await toolError(client.startResumable(START, CHUNK, OPTIONS))).code).toBe("forbidden")
    expect(requests()).toHaveLength(1)
  })

  test.each([
    ["another host", `https://upload.example.test/upload/drive/v3/files?upload_id=${UPLOAD_ID}`],
    ["another path", `https://www.googleapis.com/upload/drive/v3/other?upload_id=${UPLOAD_ID}`],
    ["no upload_id", `${UPLOAD_URL}?uploadType=resumable`],
    ["an empty upload_id", `${UPLOAD_URL}?upload_id=`],
    ["plain http", `http://www.googleapis.com/upload/drive/v3/files?upload_id=${UPLOAD_ID}`],
    ["user info", `https://someone:secret@www.googleapis.com/upload/drive/v3/files?upload_id=${UPLOAD_ID}`],
    ["a fragment", `${UPLOAD_URL}?upload_id=${UPLOAD_ID}#elsewhere`],
    ["a port", `https://www.googleapis.com:8443/upload/drive/v3/files?upload_id=${UPLOAD_ID}`],
    ["no address at all", "not a url"],
  ])("a session address with %s is upstream_error, repeated nowhere, and nothing is sent to it", async (_name, uri) => {
    const { client, requests } = clientOver([startHandler(uri), chunkHandler({ status: 200, json: {} })])
    const error = await toolError(client.startResumable(START, CHUNK, OPTIONS))
    expect(error.code).toBe("upstream_error")
    expect(error.message).not.toContain(UPLOAD_ID)
    expect(error.message).not.toContain("secret")
    expect(requests().map((call) => call.method)).toEqual(["POST"])
  })

  test("an answer with no Location header is upstream_error", async () => {
    const { client } = clientOver([startHandler(null)])
    expect((await toolError(client.startResumable(START, CHUNK, OPTIONS))).code).toBe("upstream_error")
  })
})

describe("ResumableSession.put", () => {
  test("a 308 gives the offset after the last byte Google holds, and 0 when it holds none", async () => {
    const { client } = clientOver([
      startHandler(),
      chunkHandler({ status: 308, headers: { range: `bytes=0-${CHUNK_ALIGNMENT_BYTES - 1}` } }, true),
      chunkHandler({ status: 308 }),
    ])
    const session = await client.startResumable(START, CHUNK, OPTIONS)
    expect(await session.put(FIRST_CHUNK, 0, OPTIONS.size)).toEqual({ done: false, offset: CHUNK_ALIGNMENT_BYTES })
    expect(await session.put(FIRST_CHUNK, 0, OPTIONS.size)).toEqual({ done: false, offset: 0 })
  })

  test("sends each chunk to the session address with its length, range and type, then returns the finished file", async () => {
    const file = { id: "file1", name: "report.txt" }
    const { client, requests } = clientOver([
      startHandler(),
      chunkHandler({ status: 308, headers: { range: `bytes=0-${CHUNK_ALIGNMENT_BYTES - 1}` } }, true),
      chunkHandler({ status: 200, json: file }),
    ])
    const session = await client.startResumable(START, CHUNK, OPTIONS)
    await session.put(FIRST_CHUNK, 0, OPTIONS.size)
    expect(await session.put(LAST_CHUNK, CHUNK_ALIGNMENT_BYTES, OPTIONS.size)).toEqual({ done: true, file })

    const [, first, last] = requests()
    expect(first?.url.href).toBe(SESSION_URI)
    expect(first?.headers["content-range"]).toBe(`bytes 0-${CHUNK_ALIGNMENT_BYTES - 1}/300000`)
    expect(first?.headers["content-length"]).toBe(String(CHUNK_ALIGNMENT_BYTES))
    expect(first?.headers["content-type"]).toBe("text/plain")
    expect(first?.headers.authorization).toBe(`Bearer ${FAKE_ACCESS_TOKEN}`)
    expect(first?.bytes).toEqual(FIRST_CHUNK)
    expect(last?.headers["content-range"]).toBe(`bytes ${CHUNK_ALIGNMENT_BYTES}-299999/300000`)
    expect(last?.bytes).toEqual(LAST_CHUNK)
  })

  test("a 201 also finishes, and an empty file is sent as one empty chunk", async () => {
    const { client, requests } = clientOver([startHandler(), chunkHandler({ status: 201, json: { id: "file1" } })])
    const session = await client.startResumable(START, CHUNK, { ...OPTIONS, size: 0 })
    expect(await session.put(new Uint8Array(), 0, 0)).toEqual({ done: true, file: { id: "file1" } })
    expect(requests()[1]?.headers["content-range"]).toBe("bytes */0")
  })

  test("a chunk that is not last and not a multiple of 256 KiB is internal_error, and nothing is sent", async () => {
    const { client, requests } = clientOver([startHandler()])
    const session = await client.startResumable(START, CHUNK, OPTIONS)
    const error = await toolError(session.put(new Uint8Array(CHUNK_ALIGNMENT_BYTES + 1), 0, OPTIONS.size))
    expect(error.code).toBe("internal_error")
    expect((await toolError(session.put(LAST_CHUNK, 1, OPTIONS.size))).code).toBe("internal_error")
    expect((await toolError(session.put(new Uint8Array(), 0, OPTIONS.size))).code).toBe("internal_error")
    expect(requests()).toHaveLength(1)
  })

  test("a Range that claims bytes never sent, or that cannot be read, is upstream_error", async () => {
    for (const range of [`bytes=0-${CHUNK_ALIGNMENT_BYTES}`, "bytes=5-9", "items=0-1"]) {
      const { client } = clientOver([startHandler(), chunkHandler({ status: 308, headers: { range } })])
      const session = await client.startResumable(START, CHUNK, OPTIONS)
      const error = await toolError(session.put(FIRST_CHUNK, 0, OPTIONS.size))
      expect([range, error.code]).toEqual([range, "upstream_error"])
    }
  })

  test("a failure maps as any call does, and the address and its upload_id are masked from the message", async () => {
    const message = `bad session ${SESSION_URI} id ${UPLOAD_ID}`
    const { client } = clientOver([
      startHandler(),
      chunkHandler({ status: 400, json: { error: { message, status: "INVALID_ARGUMENT" } } }),
    ])
    const session = await client.startResumable(START, CHUNK, OPTIONS)
    const error = await toolError(session.put(FIRST_CHUNK, 0, OPTIONS.size))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain(MASK)
    expect(error.message).not.toContain(UPLOAD_ID)
    expect(error.message).not.toContain("upload_id")
  })

  test("a network failure that names the address is masked too", async () => {
    const { client } = clientOver([
      startHandler(),
      chunkHandler(() => {
        throw new Error(`connect failed for ${SESSION_URI}`)
      }),
    ])
    const session = await client.startResumable(START, CHUNK, OPTIONS)
    const error = await toolError(session.put(FIRST_CHUNK, 0, OPTIONS.size))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain(MASK)
    expect(error.message).not.toContain(UPLOAD_ID)
  })

  test("a 404 is not_found, and nothing is retried", async () => {
    const { client, requests } = clientOver([startHandler(), chunkHandler({ status: 404, json: {} })])
    const session = await client.startResumable(START, CHUNK, OPTIONS)
    expect((await toolError(session.put(FIRST_CHUNK, 0, OPTIONS.size))).code).toBe("not_found")
    expect(requests()).toHaveLength(2)
  })

  test("after a 401 the same chunk is sent again with a fresh token", async () => {
    const { client, requests } = clientOver([
      startHandler(),
      chunkHandler({ status: 401, json: {} }, true),
      chunkHandler({ status: 308 }),
    ])
    const session = await client.startResumable(START, CHUNK, OPTIONS)
    await session.put(FIRST_CHUNK, 0, OPTIONS.size)
    expect(
      requests()
        .slice(1)
        .map((call) => call.bytes),
    ).toEqual([FIRST_CHUNK, FIRST_CHUNK])
  })
})
