import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { emptyPath, removeAll } from "../sheets/snapshot-renderers.testing"
import { cleanUp, freshTokens, removeUploads } from "./upload.testing"
import { encryptingFixture } from "./upload.encrypt.testing"

/** The real age and age-keygen, which these tests need on the `PATH`; without them the tests are skipped. */

const REAL_PATH = process.env.PATH ?? ""

const runs = (program: string) => spawnSync(program, ["--version"], { env: { PATH: REAL_PATH } }).status === 0
const AGE_INSTALLED = runs("age") && runs("age-keygen")

const made: string[] = []

beforeEach(freshTokens)
afterEach(async () => {
  await cleanUp()
  await removeUploads()
  await removeAll(made)
})

/** A key made by `age-keygen` in a private directory: where its secret key is, and its public key. */
async function newKey(): Promise<{ identity: string; recipient: string }> {
  const identity = join(await emptyPath(made), "key.txt")
  const keygen = spawnSync("age-keygen", ["-o", identity], { env: { PATH: REAL_PATH } })
  expect(keygen.status).toBe(0)
  const recipient = /public key: (age1[0-9a-z]+)/.exec(await readFile(identity, "utf8"))?.[1]
  return { identity, recipient: recipient! }
}

describe.skipIf(!AGE_INSTALLED)("google_drive_upload with the real age", () => {
  test("what the fake Google received decrypts with the secret key to the file", async () => {
    const { identity, recipient } = await newKey()
    const plaintext = Buffer.from(Array.from({ length: 700_000 }, (_, index) => (index * 13) % 251))
    const h = await encryptingFixture(made, {
      path: REAL_PATH,
      secrets: { "data.bin": plaintext },
      recipients: [recipient],
    })
    const result = await h.upload({ path: h.secretPath("data.bin") })

    expect(result).toMatchObject({ name: "data.bin.age", mime_type: "application/octet-stream" })
    expect(result).toMatchObject({ encrypted: { with: "age", recipients: 1 } })
    const received = Buffer.from(h.received())
    expect(received.subarray(0, "age-encryption.org/v1".length).toString()).toBe("age-encryption.org/v1")
    expect(received.includes(plaintext.subarray(0, 4096))).toBe(false)

    const decrypted = spawnSync("age", ["-d", "-i", identity], {
      env: { PATH: REAL_PATH },
      input: received,
      maxBuffer: 1 << 26,
    })
    expect(decrypted.status).toBe(0)
    expect(Buffer.from(decrypted.stdout).equals(plaintext)).toBe(true)
  })
})
