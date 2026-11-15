import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { CREDENTIAL, toolError } from "../google/client.fixtures"
import type { FakeHandler } from "../google/fake-google.testing"
import {
  BATCH_GET_URL,
  FILES_URL,
  SPREADSHEET_ID,
  SPREADSHEET_URL,
  answer,
  cleanUp,
  fixture,
  freshTokens,
} from "./read.testing"
import { DRIVE_METADATA_READ_SCOPE, SHEETS_READ_SCOPE } from "./scopes"

beforeEach(freshTokens)
afterEach(cleanUp)

const CALLS = [
  ["list", { method: "list" }],
  ["view", { method: "view", spreadsheet: SPREADSHEET_ID }],
  ["values", { method: "values", spreadsheet: SPREADSHEET_ID, ranges: ["A1:B2"] }],
] as const

const failing = (url: string, status: number, error: Record<string, unknown>): FakeHandler => ({
  method: "GET",
  url,
  reply: { status, json: { error } },
})

describe("google_sheets_read: the label's scopes", () => {
  test.each(CALLS)(
    "%s fails as unauthenticated, before any request, for a label logged in for account only",
    async (_method, args) => {
      const h = await fixture([], CREDENTIAL)

      const error = await toolError(h.read(args))

      expect(error).toMatchObject({ code: "unauthenticated" })
      expect(error.message).toContain("was not logged in with a scope this call needs")
      expect(error.message).toContain("Ask a person to log it in again with: ")
      expect(error.message).toContain("login --account work --toolsets account,sheets")
      expect(error.message).toContain("--state-dir")
      expect(error.message).not.toContain("--read-only")
      const fix = String(error.details?.fix)
      expect(fix).toContain("login --account work --toolsets account,sheets")
      expect(error.message.endsWith(fix)).toBe(true)
      expect(h.requests).toEqual([])
    },
  )

  test("list needs a Drive scope, which the Sheets scope alone is not", async () => {
    const h = await fixture([], { ...CREDENTIAL, scopes: [...CREDENTIAL.scopes, SHEETS_READ_SCOPE] })

    await expect(h.read({ method: "list" })).rejects.toMatchObject({
      code: "unauthenticated",
      details: { account: "work", needs: expect.arrayContaining([DRIVE_METADATA_READ_SCOPE]) },
    })
    expect(h.requests).toEqual([])
  })

  test("view and values need no Drive scope", async () => {
    const h = await fixture([answer(SPREADSHEET_URL, {}), answer(BATCH_GET_URL, {})], {
      ...CREDENTIAL,
      scopes: [...CREDENTIAL.scopes, SHEETS_READ_SCOPE],
    })

    await h.read({ method: "view", spreadsheet: SPREADSHEET_ID })
    await h.read({ method: "values", spreadsheet: SPREADSHEET_ID, ranges: ["A1"] })

    expect(h.calls()).toHaveLength(2)
  })

  test("a label that does not exist is not_found, naming the ones that do", async () => {
    const h = await fixture([], CREDENTIAL)

    await expect(h.read({ method: "list", account: "other" })).rejects.toMatchObject({ code: "not_found" })
    expect(h.requests).toEqual([])
  })

  test("no account at all is not_found", async () => {
    const h = await fixture([], null)
    await expect(h.read({ method: "list" })).rejects.toMatchObject({ code: "not_found" })
  })
})

describe("google_sheets_read: Google's refusals", () => {
  test("a spreadsheet that does not exist is not_found", async () => {
    const h = await fixture([
      failing(SPREADSHEET_URL, 404, { code: 404, message: "Requested entity was not found.", status: "NOT_FOUND" }),
    ])

    await expect(h.read({ method: "view", spreadsheet: SPREADSHEET_ID })).rejects.toMatchObject({
      code: "not_found",
      message: expect.stringContaining("Requested entity was not found."),
    })
  })

  test("a spreadsheet the account may not read is forbidden", async () => {
    const h = await fixture([
      failing(BATCH_GET_URL, 403, {
        code: 403,
        message: "The caller does not have permission",
        status: "PERMISSION_DENIED",
      }),
    ])

    await expect(h.read({ method: "values", spreadsheet: SPREADSHEET_ID, ranges: ["A1:B2"] })).rejects.toMatchObject({
      code: "forbidden",
    })
  })

  test("a range Google cannot parse is upstream_error carrying Google's text", async () => {
    const h = await fixture([
      failing(BATCH_GET_URL, 400, { code: 400, message: "Unable to parse range: Nope!A1", status: "INVALID_ARGUMENT" }),
    ])

    await expect(h.read({ method: "values", spreadsheet: SPREADSHEET_ID, ranges: ["Nope!A1"] })).rejects.toMatchObject({
      code: "upstream_error",
      message: expect.stringContaining("Unable to parse range"),
    })
  })

  test("the Drive list being refused is forbidden", async () => {
    const h = await fixture([
      failing(FILES_URL, 403, { code: 403, message: "Insufficient Permission", status: "PERMISSION_DENIED" }),
    ])

    await expect(h.read({ method: "list" })).rejects.toMatchObject({ code: "forbidden" })
  })
})

describe("google_sheets_read: arguments", () => {
  test.each([
    ["list", { method: "list", spreadsheet: SPREADSHEET_ID }, "spreadsheet"],
    ["list", { method: "list", ranges: ["A1"] }, "ranges"],
    ["view", { method: "view", spreadsheet: SPREADSHEET_ID, limit: 5 }, "limit"],
    ["view", { method: "view", spreadsheet: SPREADSHEET_ID, render: "formula" }, "render"],
    ["values", { method: "values", spreadsheet: SPREADSHEET_ID, ranges: ["A1"], query: "x" }, "query"],
  ])("%s refuses `%2$s`'s stray argument before any request", async (_method, args, stray) => {
    const h = await fixture()

    await expect(h.read(args)).rejects.toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining(`takes no \`${stray}\``),
    })
    expect(h.requests).toEqual([])
  })

  test("view and values need a spreadsheet", async () => {
    const h = await fixture()

    await expect(h.read({ method: "view" })).rejects.toMatchObject({ code: "invalid_argument" })
    await expect(h.read({ method: "values", ranges: ["A1"] })).rejects.toMatchObject({ code: "invalid_argument" })
    expect(h.requests).toEqual([])
  })

  test("an unknown argument or method is invalid_argument", async () => {
    const h = await fixture()

    await expect(h.read({ method: "list", nope: 1 })).rejects.toMatchObject({ code: "invalid_argument" })
    await expect(h.read({ method: "write" })).rejects.toMatchObject({ code: "invalid_argument" })
  })

  test("a refused spreadsheet does not echo more than 100 characters of it", async () => {
    const h = await fixture()

    const error = await h
      .read({ method: "view", spreadsheet: `https://example.test/${"q".repeat(300)}` })
      .catch((e) => e)

    expect(error).toMatchObject({ code: "invalid_argument" })
    expect(String(error.message)).not.toContain("q".repeat(101))
  })
})
