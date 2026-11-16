import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { link, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { toolError } from "../google/client.fixtures"
import { cleanUp, freshTokens, removeUploads, sendFixture, SEND_CREDENTIAL } from "./send.testing"

beforeEach(freshTokens)
afterEach(async () => {
  await cleanUp()
  await removeUploads()
})

const base = { to: ["ann@example.test"], subject: "Lunch", body: "Are we still on?" }

const addresses = (count: number, domain = "example.test") =>
  Array.from({ length: count }, (_, index) => `person${index}@${domain}`)

/** The error the call fails with, and that nothing was requested of Google. */
async function refused(args: unknown) {
  const h = await sendFixture()
  const error = await toolError(h.send(args))
  expect(h.calls()).toEqual([])
  return error
}

describe("google_gmail_send addresses", () => {
  test("takes 1 to 100 in to, up to 100 each in cc and bcc, and 100 in all", async () => {
    const h = await sendFixture()
    await h.send({ ...base, to: addresses(1) })
    await h.send({ ...base, to: addresses(100) })
    await h.send({ ...base, to: addresses(50), cc: addresses(25, "cc.test"), bcc: addresses(25, "bcc.test") })
    expect(h.sends().length).toBe(3)
  })

  test("refuses no recipient in to, more than 100 in a list, and more than 100 in all", async () => {
    expect((await refused({ ...base, to: [] })).code).toBe("invalid_argument")
    expect((await refused({ ...base, to: addresses(101) })).code).toBe("invalid_argument")
    expect((await refused({ ...base, cc: addresses(101, "cc.test") })).code).toBe("invalid_argument")
    const all = await refused({
      ...base,
      to: addresses(60),
      cc: addresses(30, "cc.test"),
      bcc: addresses(11, "bcc.test"),
    })
    expect(all.message).toContain("101 recipients")
  })

  test.each(["Ann <ann@example.test>", "ann@example", "ann", "a b@example.test", "ann@example.test, bob@example.test"])(
    "refuses a display name, a list or a malformed address: %s",
    async (address) => {
      expect((await refused({ ...base, to: [address] })).code).toBe("invalid_argument")
    },
  )

  test("refuses an address with a line break, which could add a header", async () => {
    for (const address of ["ann@example.test\nBcc: eve@example.test", "ann\r@example.test"]) {
      expect((await refused({ ...base, to: [address] })).code).toBe("invalid_argument")
    }
  })

  test("refuses an address that is not plain ASCII", async () => {
    expect((await refused({ ...base, to: ["ånn@example.test"] })).code).toBe("invalid_argument")
  })

  test("refuses an address held twice, in one list or across them, ignoring case", async () => {
    const same = await refused({ ...base, to: ["ann@example.test", "ann@example.test"] })
    expect(same.message).toContain("ann@example.test")
    expect((await refused({ ...base, cc: ["ANN@example.test"] })).code).toBe("invalid_argument")
    expect((await refused({ ...base, bcc: ["Ann@Example.test"] })).code).toBe("invalid_argument")
    expect((await refused({ ...base, cc: ["bob@example.test"], bcc: ["bob@example.test"] })).code).toBe(
      "invalid_argument",
    )
  })

  test("keeps an address's case in the mail while comparing without it", async () => {
    const h = await sendFixture()
    await h.send({ ...base, to: ["Ann@Example.test"] })
    expect(Buffer.from(h.sends()[0]!.bytes!).toString("latin1")).toContain("To: Ann@Example.test\r\n")
  })

  test("refuses a subject with a line break, and a body or subject out of its limits", async () => {
    expect((await refused({ ...base, subject: "Lunch\nBcc: eve@example.test" })).code).toBe("invalid_argument")
    expect((await refused({ ...base, subject: "" })).code).toBe("invalid_argument")
    expect((await refused({ ...base, subject: "x".repeat(301) })).code).toBe("invalid_argument")
    expect((await refused({ ...base, body: "" })).code).toBe("invalid_argument")
    expect((await refused({ ...base, body: "x".repeat(200_001) })).code).toBe("invalid_argument")
  })

  test("takes a body of 200,000 characters", async () => {
    const h = await sendFixture()
    await h.send({ ...base, body: "x".repeat(200_000) })
    expect(h.sends().length).toBe(1)
  })
})

describe("google_gmail_send attachments", () => {
  test("with no upload directory set, any attachment is forbidden, naming the setting, and nothing is sent", async () => {
    const h = await sendFixture({ files: { "a.txt": "x" }, uploadDirs: () => [] })
    const error = await toolError(h.send({ ...base, attachments: [join(h.uploadDir, "a.txt")] }))
    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("upload_dirs")
    expect(h.sends()).toEqual([])
  })

  test("a file outside the upload directories, a relative path, a link and a hard link are refused, and nothing is sent", async () => {
    const h = await sendFixture({ files: { "a.txt": "x" } })
    const outside = join(h.uploadDir, "..", "secret.txt")
    await writeFile(outside, "secret")
    await symlink(outside, join(h.uploadDir, "linked.txt"))
    await link(outside, join(h.uploadDir, "hard.txt"))
    const cases = [
      [outside, "forbidden"],
      ["a.txt", "invalid_argument"],
      [join(h.uploadDir, "linked.txt"), "forbidden"],
      [join(h.uploadDir, "hard.txt"), "forbidden"],
      [join(h.uploadDir, "missing.txt"), "not_found"],
    ] as const
    for (const [path, code] of cases) {
      expect([path, (await toolError(h.send({ ...base, attachments: [path] }))).code]).toEqual([path, code])
    }
    expect(h.sends()).toEqual([])
  })

  test("a file inside the state directory is refused even when an upload directory holds it", async () => {
    const h = await sendFixture({ uploadDirs: (_uploadDir, stateDir) => [stateDir] })
    const secret = join(h.stateDir, "note.txt")
    await writeFile(secret, "x")
    const error = await toolError(h.send({ ...base, attachments: [secret] }))
    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("state directory")
    expect(h.sends()).toEqual([])
  })

  test("takes up to 20 attachments and refuses 21 and none", async () => {
    const files = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`f${index}.txt`, `${index}`]))
    const h = await sendFixture({ files })
    const paths = Object.keys(files).map((name) => join(h.uploadDir, name))
    await h.send({ ...base, attachments: paths.slice(0, 20) })
    expect(h.sends().length).toBe(1)
    expect((await toolError(h.send({ ...base, attachments: paths }))).code).toBe("invalid_argument")
    expect((await toolError(h.send({ ...base, attachments: [] }))).code).toBe("invalid_argument")
  })

  test("takes 25 MiB of attachments in all and refuses one byte more, however many files", async () => {
    const MIB = 1024 * 1024
    const h = await sendFixture({
      files: { "a.bin": Buffer.alloc(10 * MIB), "b.bin": Buffer.alloc(15 * MIB), "c.bin": Buffer.alloc(1) },
    })
    const path = (name: string) => join(h.uploadDir, name)
    await h.send({ ...base, attachments: [path("a.bin"), path("b.bin")] })
    expect(h.sends().length).toBe(1)
    const error = await toolError(h.send({ ...base, attachments: [path("a.bin"), path("b.bin"), path("c.bin")] }))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("25 MiB")
    expect(h.sends().length).toBe(1)
  })

  test("refuses one file of more than 25 MiB", async () => {
    const h = await sendFixture({ files: { "big.bin": Buffer.alloc(25 * 1024 * 1024 + 1) } })
    expect((await toolError(h.send({ ...base, attachments: [join(h.uploadDir, "big.bin")] }))).code).toBe(
      "invalid_argument",
    )
  })
})

describe("google_gmail_send scopes", () => {
  test("a label without a send scope fails before any request, naming the login that adds it", async () => {
    const h = await sendFixture({ credential: { ...SEND_CREDENTIAL, scopes: SEND_CREDENTIAL.scopes.slice(0, 2) } })
    const error = await toolError(h.send(base))
    expect(error.code).toBe("unauthenticated")
    expect(error.message).toContain("login")
    expect(h.requests).toEqual([])
  })

  test("the compose and the modify scope also let a label send", async () => {
    for (const scope of [
      "https://www.googleapis.com/auth/gmail.compose",
      "https://www.googleapis.com/auth/gmail.modify",
    ]) {
      const h = await sendFixture({
        credential: { ...SEND_CREDENTIAL, scopes: [...SEND_CREDENTIAL.scopes.slice(0, 2), scope] },
      })
      await h.send(base)
      expect(h.sends().length).toBe(1)
      await cleanUp()
    }
  })

  test("a reply from a label that may send but not read fails before any request", async () => {
    const h = await sendFixture({ credential: SEND_CREDENTIAL })
    const error = await toolError(h.send({ to: base.to, reply_to: "18f3a2b4c5d6e7f0", body: "x" }))
    expect(error.code).toBe("unauthenticated")
    expect(h.requests).toEqual([])
  })
})
