import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { CLI } from "../account/read.testing"
import { SHEETS_ROUTES } from "../sheets/routes"
import { DRIVE_METADATA_READ_SCOPE, SHEETS_READ_SCOPE, SHEETS_WRITE_SCOPE } from "../sheets/scopes"
import { SHEETS_CREDENTIAL, cleanUp, fixture, freshTokens } from "../sheets/read.testing"
import { TOOLSET_SCOPES, type ToolsetScopes } from "./scopes"
import { googleSession } from "./session"
import { toolError } from "./client.fixtures"
import type { Route } from "./routes"

const NOTES_READ = "https://www.example.test/auth/notes.readonly"

beforeEach(freshTokens)
afterEach(async () => {
  delete (TOOLSET_SCOPES as Record<string, ToolsetScopes>).notes
  await cleanUp()
})

/** The error a call of a route that takes any one of `scopes` fails with, and the command it names. */
async function refusal(scopes: readonly string[], credential = SHEETS_CREDENTIAL) {
  const h = await fixture([], credential)
  const { client, label } = await googleSession(h.ctx, undefined, "Test calls")
  const route: Route = { ...SHEETS_ROUTES.spreadsheet, scopes }
  const error = await toolError(client.request(route, { params: { spreadsheet_id: "sheet-0123456789" } }))
  expect(h.requests).toEqual([])
  return { error, label, stateDir: h.stateDir, fix: String(error.details?.fix) }
}

describe("googleSession's missing-scope fix", () => {
  test("names the label, the toolsets it holds plus the ones needed, and the state directory", async () => {
    const { fix, stateDir } = await refusal([SHEETS_WRITE_SCOPE], { ...SHEETS_CREDENTIAL, scopes: [] })

    expect(fix).toBe(`${CLI} login --account work --toolsets sheets --state-dir ${stateDir}`)
  })

  test("a label that holds a read-only toolset gets all of it back, and the write scope when the call needs it", async () => {
    const { fix, stateDir } = await refusal([SHEETS_WRITE_SCOPE])

    expect(fix).toBe(`${CLI} login --account work --toolsets account,sheets --state-dir ${stateDir}`)
    expect(fix).not.toContain("--read-only")
  })

  test("a label that holds only reading keeps to reading when the call needs a read scope", async () => {
    ;(TOOLSET_SCOPES as Record<string, ToolsetScopes>).notes = { read: [NOTES_READ], write: [] }
    const credential = { ...SHEETS_CREDENTIAL, scopes: [...SHEETS_CREDENTIAL.scopes] }

    const { fix, stateDir } = await refusal([NOTES_READ], credential)

    expect(fix).toBe(`${CLI} login --account work --toolsets account,sheets,notes --read-only --state-dir ${stateDir}`)
  })

  test("a label that holds the whole toolset is not asked to be read only", async () => {
    const credential = { ...SHEETS_CREDENTIAL, scopes: [...SHEETS_CREDENTIAL.scopes, SHEETS_WRITE_SCOPE] }

    const { fix } = await refusal([NOTES_READ], credential)

    expect(fix).toContain("--toolsets account,sheets ")
    expect(fix).not.toContain("--read-only")
  })

  test("the message ends with the same command", async () => {
    const { error, fix } = await refusal([DRIVE_METADATA_READ_SCOPE], {
      ...SHEETS_CREDENTIAL,
      scopes: [SHEETS_READ_SCOPE],
    })

    expect(error.message.endsWith(fix)).toBe(true)
  })
})
