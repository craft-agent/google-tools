import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isToolError, type ToolError } from "../errors"
import {
  credentialSecrets,
  credentialVariable,
  parseCredential,
  readCredential,
  serializeCredential,
  writeCredential,
  type Credential,
} from "./credentials"
import { labelPaths, type LabelPaths } from "./labels"

const REFRESH = "1//madeUpRefreshToken0123456789"
const CLIENT_ID = "made-up-client.apps.example"
const CLIENT_SECRET = "madeUpClientSecret987654"
const VARIABLE = "GT_CREDENTIALS_WORK"

const CREDENTIAL: Credential = {
  refresh_token: REFRESH,
  client_id: CLIENT_ID,
  client_secret: CLIENT_SECRET,
  scopes: ["scope.a", "scope.b"],
  email: "someone@example.test",
}

let tempDir: string
let paths: LabelPaths

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "gcred-"))
  paths = labelPaths(tempDir, "work")
  await mkdir(paths.dir, { recursive: true })
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

async function failureOf(promise: Promise<unknown>): Promise<ToolError> {
  try {
    await promise
  } catch (error) {
    if (isToolError(error)) return error
    throw error
  }
  throw new Error("expected a ToolError")
}

function parseFailure(text: string): ToolError {
  try {
    parseCredential(text, "The text")
  } catch (error) {
    if (isToolError(error)) return error
    throw error
  }
  throw new Error("expected a ToolError")
}

function fileText(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...CREDENTIAL, ...overrides })
}

describe("credentialVariable and credentialSecrets", () => {
  test("names the variable after the prefix and the upper-cased label", () => {
    expect(credentialVariable("GT", "work_2")).toBe("GT_CREDENTIALS_WORK_2")
  })

  test("lists the refresh token and the client secret", () => {
    expect(credentialSecrets(CREDENTIAL)).toEqual([REFRESH, CLIENT_SECRET])
  })
})

describe("readCredential from the variable", () => {
  test("wins over the file, which is then not read", async () => {
    await writeFile(paths.credentials, "{not json", { mode: 0o600 })
    const result = await readCredential({ paths, variable: VARIABLE, env: { [VARIABLE]: `  ${fileText()}\n` } })
    expect(result).toEqual({ source: "variable", credential: CREDENTIAL })
  })

  test("an empty variable is unauthenticated, naming the variable", async () => {
    await writeFile(paths.credentials, fileText(), { mode: 0o600 })
    const error = await failureOf(readCredential({ paths, variable: VARIABLE, env: { [VARIABLE]: "" } }))
    expect(error.code).toBe("unauthenticated")
    expect(error.message).toContain(`\`${VARIABLE}\``)
  })
})

describe("readCredential from the file", () => {
  test("reads a private regular file", async () => {
    await writeFile(paths.credentials, fileText(), { mode: 0o600 })
    expect(await readCredential({ paths, variable: VARIABLE, env: {} })).toEqual({
      source: "file",
      credential: CREDENTIAL,
    })
  })

  test("a missing file is unauthenticated with the account and variable in details", async () => {
    const error = await failureOf(readCredential({ paths, variable: VARIABLE, env: {} }))
    expect(error.code).toBe("unauthenticated")
    expect(error.message).toBe(
      `No credential for Google account "work": set ${VARIABLE} or log in with the login command.`,
    )
    expect(error.details).toEqual({ account: "work", variable: VARIABLE })
  })

  test("a symlink is forbidden, even to a private file", async () => {
    const target = join(tempDir, "target.json")
    await writeFile(target, fileText(), { mode: 0o600 })
    await symlink(target, paths.credentials)
    expect((await failureOf(readCredential({ paths, variable: VARIABLE, env: {} }))).code).toBe("forbidden")
  })

  test("a directory is forbidden", async () => {
    await mkdir(paths.credentials)
    expect((await failureOf(readCredential({ paths, variable: VARIABLE, env: {} }))).code).toBe("forbidden")
  })

  test("a file readable by others is forbidden and the message names chmod 600", async () => {
    await writeFile(paths.credentials, fileText())
    await chmod(paths.credentials, 0o644)
    const error = await failureOf(readCredential({ paths, variable: VARIABLE, env: {} }))
    expect(error.code).toBe("forbidden")
    expect(error.message).toContain(`chmod 600 "${paths.credentials}"`)
  })

  test("a file that is not a credential is unauthenticated, naming the file", async () => {
    await writeFile(paths.credentials, "{}", { mode: 0o600 })
    const error = await failureOf(readCredential({ paths, variable: VARIABLE, env: {} }))
    expect(error.code).toBe("unauthenticated")
    expect(error.message).toStartWith(`The credential file ${paths.credentials} is not a Google credential: `)
  })
})

describe("parseCredential", () => {
  test("sorts and deduplicates scopes, and an absent or null email is null", () => {
    const { email: _email, ...withoutEmail } = CREDENTIAL
    const parsed = parseCredential(JSON.stringify({ ...withoutEmail, scopes: ["b", "a", "b"], extra: 1 }), "x")
    expect(parsed).toEqual({ ...CREDENTIAL, scopes: ["a", "b"], email: null })
    expect(parseCredential(fileText({ email: null }), "x").email).toBeNull()
  })

  test("names each invalid field", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ refresh_token: "" }, "refresh_token"],
      [{ refresh_token: 5 }, "refresh_token"],
      [{ client_id: undefined }, "client_id"],
      [{ client_secret: null }, "client_secret"],
      [{ scopes: "a b" }, "scopes"],
      [{ scopes: ["a", ""] }, "scopes"],
      [{ scopes: undefined }, "scopes"],
      [{ email: "" }, "email"],
      [{ email: 7 }, "email"],
    ]
    for (const [overrides, field] of cases) {
      const error = parseFailure(fileText(overrides))
      expect(error.code).toBe("unauthenticated")
      expect(error.message).toStartWith(`The text is not a Google credential: ${field} `)
    }
  })

  test("refuses text that is not a JSON object", () => {
    for (const text of ["", "[]", "null", '"text"', "12"]) {
      expect(parseFailure(text).code).toBe("unauthenticated")
    }
  })

  test("no error message holds the refresh token or the client secret", () => {
    const texts = [
      `{"refresh_token": "${REFRESH}", "client_secret": "${CLIENT_SECRET}"`,
      `${REFRESH} ${CLIENT_SECRET}`,
      fileText({ client_id: "" }),
      fileText({ scopes: [REFRESH, ""] }),
      fileText({ email: CLIENT_SECRET.length }),
      JSON.stringify([REFRESH, CLIENT_SECRET]),
    ]
    for (const text of texts) {
      const message = parseFailure(text).message
      expect(message).not.toContain(REFRESH)
      expect(message).not.toContain(CLIENT_SECRET)
    }
  })
})

describe("writeCredential", () => {
  test("serializes the five fields in order, indented, with a trailing newline", () => {
    const text = serializeCredential(CREDENTIAL)
    expect(text.endsWith("}\n")).toBe(true)
    expect(Object.keys(JSON.parse(text))).toEqual(["refresh_token", "client_id", "client_secret", "scopes", "email"])
    expect(text).toContain('\n  "client_id": ')
  })

  test("writes a private file that reads back", async () => {
    await writeCredential(paths, { ...CREDENTIAL, scopes: ["b", "a", "b"], email: null })
    expect((await stat(paths.credentials)).mode & 0o777).toBe(0o600)
    const { source, credential } = await readCredential({ paths, variable: VARIABLE, env: {} })
    expect(source).toBe("file")
    expect(credential).toEqual({ ...CREDENTIAL, scopes: ["a", "b"], email: null })
  })
})
