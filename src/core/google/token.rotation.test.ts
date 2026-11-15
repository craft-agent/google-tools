import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readFile, rm, stat } from "node:fs/promises"
import {
  CREDENTIAL,
  REFRESH_TOKEN,
  ROTATED_REFRESH_TOKEN,
  TOKEN_URL,
  VARIABLE,
  makeLabel,
  storeCredential,
  variableEnv,
} from "./client.fixtures"
import { parseCredential } from "./credentials"
import { FAKE_ACCESS_TOKEN, fakeGoogle, tokenReply, type FakeHandler } from "./fake-google.testing"
import type { LabelPaths } from "./labels"
import { TokenSource, clearTokenCache } from "./token"

const NEWER_LOGIN_REFRESH_TOKEN = "madeUpNewerLogin-EEEE5555555555"

let stateDir: string
let paths: LabelPaths

beforeEach(async () => {
  clearTokenCache()
  ;({ stateDir, paths } = await makeLabel())
})

afterEach(async () => {
  await rm(stateDir, { recursive: true, force: true })
})

function sourceOver(handlers: FakeHandler[], env: Record<string, string> = {}) {
  const google = fakeGoogle(handlers)
  return { source: new TokenSource({ paths, variable: VARIABLE, env, fetch: google.fetch }), requests: google.requests }
}

const rotatingReply: FakeHandler = {
  method: "POST",
  url: TOKEN_URL,
  reply: { json: tokenReply({ refresh_token: ROTATED_REFRESH_TOKEN }) },
}

async function fileCredential() {
  return parseCredential(await readFile(paths.credentials, "utf8"), "The file")
}

describe("a rotated refresh token", () => {
  test("replaces the old one in the credential file, keeping the rest and the mode", async () => {
    await storeCredential(paths)
    const { source } = sourceOver([rotatingReply])
    const grant = await source.accessToken()
    expect(await fileCredential()).toEqual({ ...CREDENTIAL, refresh_token: ROTATED_REFRESH_TOKEN })
    expect(grant.credential.refresh_token).toBe(ROTATED_REFRESH_TOKEN)
    expect((await stat(paths.credentials)).mode & 0o777).toBe(0o600)
  })

  test("is the one used for the next refresh, and the cache follows it", async () => {
    await storeCredential(paths)
    const { source, requests } = sourceOver([rotatingReply])
    await source.accessToken()
    expect((await source.accessToken()).token).toBe(FAKE_ACCESS_TOKEN)
    expect(requests).toHaveLength(1)
  })

  test("is not written when the file was replaced by a newer login meanwhile", async () => {
    await storeCredential(paths)
    const { source } = sourceOver([
      {
        method: "POST",
        url: TOKEN_URL,
        reply: async () => {
          await storeCredential(paths, { ...CREDENTIAL, refresh_token: NEWER_LOGIN_REFRESH_TOKEN })
          return { json: tokenReply({ refresh_token: ROTATED_REFRESH_TOKEN }) }
        },
      },
    ])
    const grant = await source.accessToken()
    expect((await fileCredential()).refresh_token).toBe(NEWER_LOGIN_REFRESH_TOKEN)
    expect(grant.credential.refresh_token).toBe(REFRESH_TOKEN)
  })

  test("is not written when the file was removed meanwhile", async () => {
    await storeCredential(paths)
    const { source } = sourceOver([
      {
        method: "POST",
        url: TOKEN_URL,
        reply: async () => {
          await rm(paths.credentials)
          return { json: tokenReply({ refresh_token: ROTATED_REFRESH_TOKEN }) }
        },
      },
    ])
    expect((await source.accessToken()).token).toBe(FAKE_ACCESS_TOKEN)
    await expect(stat(paths.credentials)).rejects.toThrow()
  })

  test("is never written for a credential from the variable", async () => {
    await storeCredential(paths, { ...CREDENTIAL, refresh_token: NEWER_LOGIN_REFRESH_TOKEN })
    const before = await readFile(paths.credentials, "utf8")
    const { source, requests } = sourceOver([rotatingReply], variableEnv())
    const grant = await source.accessToken()
    expect(grant.source).toBe("variable")
    expect(await readFile(paths.credentials, "utf8")).toBe(before)
    expect(grant.credential.refresh_token).toBe(REFRESH_TOKEN)
    // The variable still holds the old token, so the cache stays keyed by it.
    await source.accessToken()
    expect(requests).toHaveLength(1)
  })

  test("the same refresh token in the reply changes nothing", async () => {
    await storeCredential(paths)
    const before = await readFile(paths.credentials, "utf8")
    const { source } = sourceOver([
      { method: "POST", url: TOKEN_URL, reply: { json: tokenReply({ refresh_token: REFRESH_TOKEN }) } },
    ])
    await source.accessToken()
    expect(await readFile(paths.credentials, "utf8")).toBe(before)
  })
})
