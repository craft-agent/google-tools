import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { symlink } from "node:fs/promises"
import { join } from "node:path"
import { toolError } from "../google/client.fixtures"
import { removeAll, renderCalls } from "../sheets/snapshot-renderers.testing"
import { OTHER_RECIPIENT, RECIPIENT } from "./age.testing"
import { cleanUp, freshTokens, removeUploads } from "./upload.testing"
import { SECRET_DIR, encryptingFixture, type EncryptingOptions } from "./upload.encrypt.testing"

const made: string[] = []

beforeEach(freshTokens)
afterEach(async () => {
  await cleanUp()
  await removeUploads()
  await removeAll(made)
})

const CONTENT = "quarterly figures"
const SHA256 = createHash("sha256").update(CONTENT).digest("hex")

const fixture = (options: EncryptingOptions = {}) =>
  encryptingFixture(made, { secrets: { "report.txt": CONTENT }, files: { "open.txt": CONTENT }, ...options })

type Fixture = Awaited<ReturnType<typeof fixture>>

const secretArgs = (h: Fixture, extra: Record<string, unknown> = {}) => ({ path: h.secretPath("report.txt"), ...extra })
const openArgs = (h: Fixture, extra: Record<string, unknown> = {}) => ({
  path: join(h.uploadDir, "open.txt"),
  ...extra,
})

const factsOf = (description: { facts: { label: string; value: unknown }[] }) =>
  Object.fromEntries(description.facts.map((fact) => [fact.label, fact.value]))

describe("google_drive_upload under encrypt_dirs: the decision", () => {
  test("a file under the encryption directory goes up encrypted, named .age, as application/octet-stream", async () => {
    const h = await fixture()
    const description = await h.describe(secretArgs(h))

    expect(description.headline?.values).toEqual({ name: "report.txt.age", folder: "My Drive" })
    expect(description.facts).toEqual([
      { label: "From", value: h.secretPath("report.txt") },
      { label: "Encrypted", value: { text: "yes, with age to {count} recipients", values: { count: 2 } } },
      { label: "Size", value: { text: "{bytes} bytes", values: { bytes: 17 } } },
      { label: "Type", value: "application/octet-stream" },
    ])
  })

  test("a file outside it says no, and is untouched: its own name and type, and age is never run", async () => {
    const h = await fixture()
    const description = await h.describe(openArgs(h))

    expect(description.headline?.values).toEqual({ name: "open.txt", folder: "My Drive" })
    expect(factsOf(description).Encrypted).toEqual({ text: "no" })
    expect(factsOf(description).Type).toBe("text/plain")
    expect(Object.keys(description.pins ?? {})).toEqual(["content", "folder"])
    expect(await renderCalls(h.bin)).toEqual([])
  })

  test("the Encrypted fact is left out when encrypt_dirs names nothing", async () => {
    const h = await fixture({ encryptDirs: () => [] })
    const description = await h.describe(secretArgs(h))

    expect(Object.keys(factsOf(description))).toEqual(["From", "Size", "Type"])
    expect(description.headline?.values?.name).toBe("report.txt")
  })

  test("a directory that does not exist holds no file elsewhere, so nothing is encrypted for it", async () => {
    const h = await fixture({ encryptDirs: (dir) => [`${dir}-missing`] })
    expect(factsOf(await h.describe(secretArgs(h))).Encrypted).toEqual({ text: "no" })
  })

  test("a file whose path is spelled with another case is still encrypted", async () => {
    const h = await fixture({ encryptDirs: (dir) => [dir.replace(SECRET_DIR, "SECRET")] })
    expect(factsOf(await h.describe(secretArgs(h))).Encrypted).toMatchObject({ values: { count: 2 } })
  })

  test("a path through a link that resolves into the encryption directory is encrypted", async () => {
    const h = await fixture()
    await symlink(h.secretDir, join(h.uploadDir, "alias"))
    const description = await h.describe({ path: join(h.uploadDir, "alias", "report.txt") })

    expect(factsOf(description).From).toBe(h.secretPath("report.txt"))
    expect(factsOf(description).Encrypted).toMatchObject({ values: { count: 2 } })
  })

  test("a file outside the upload directories is still refused: encrypt_dirs widens nothing", async () => {
    const h = await fixture({ encryptDirs: (dir) => [join(dir, "..", "..")] })
    const error = await toolError(h.upload({ path: join(h.uploadDir, "..", "elsewhere.txt") }))
    expect(error.code).toBe("forbidden")
    expect(h.calls()).toEqual([])
  })
})

describe("google_drive_upload under encrypt_dirs: the name, the type and the prompt", () => {
  test("adds .age once to the given name, and to the file's own name", async () => {
    const h = await fixture({ secrets: { "report.txt": CONTENT, "keys.age": CONTENT } })
    const named = async (args: Record<string, unknown>) => (await h.describe(args)).headline?.values?.name

    expect(await named(secretArgs(h, { name: "Q3" }))).toBe("Q3.age")
    expect(await named(secretArgs(h, { name: "Q3.age" }))).toBe("Q3.age")
    expect(await named({ path: h.secretPath("keys.age") })).toBe("keys.age")
    expect(await named(secretArgs(h))).toBe("report.txt.age")
  })

  test("looks for files already there under the name with .age", async () => {
    const h = await fixture()
    await h.describe(secretArgs(h, { name: "Q3" }))
    const list = h.calls().find((call) => call.url.pathname === "/drive/v3/files")!
    expect(list.url.searchParams.get("q")).toContain("name = 'Q3.age'")
  })

  test("a name that .age would make too long is refused", async () => {
    const h = await fixture()
    const error = await toolError(h.upload(secretArgs(h, { name: "n".repeat(499) })))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("longer than 500")
  })

  test("mime_type is refused for an encrypted file, and still taken for one outside", async () => {
    const h = await fixture()
    const error = await toolError(h.describe(secretArgs(h, { mime_type: "text/plain" })))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("application/octet-stream")
    expect(h.calls()).toEqual([])

    expect(factsOf(await h.describe(openArgs(h, { mime_type: "application/x-made-up" }))).Type).toBe(
      "application/x-made-up",
    )
  })

  test("one recipient reads in the singular, and a repeated recipient counts once", async () => {
    const h = await fixture({ recipients: [RECIPIENT, RECIPIENT] })
    expect(factsOf(await h.describe(secretArgs(h))).Encrypted).toEqual({
      text: "yes, with age to {count} recipient",
      values: { count: 1 },
    })
  })

  test("pins the content, the folder and a digest of the sorted recipients, and no key is in the prompt", async () => {
    const h = await fixture()
    const description = await h.describe(secretArgs(h))
    const digest = createHash("sha256")
      .update(JSON.stringify([OTHER_RECIPIENT, RECIPIENT]))
      .digest("hex")

    expect(description.pins).toMatchObject({ content: SHA256, recipients: digest })
    expect(Object.keys(description.pins ?? {}).sort()).toEqual(["content", "folder", "recipients"])
    expect(JSON.stringify(description.facts)).not.toContain(RECIPIENT)

    const swapped = await fixture({ recipients: [OTHER_RECIPIENT, RECIPIENT] })
    expect((await swapped.describe(secretArgs(swapped))).pins?.recipients).toBe(digest)
    const another = await fixture({ recipients: [OTHER_RECIPIENT] })
    expect((await another.describe(secretArgs(another))).pins?.recipients).not.toBe(digest)
  })

  test("the size is the plaintext's, which is what the bound measures", async () => {
    const h = await fixture()
    expect(await h.measure(secretArgs(h))).toEqual({ bytes: 17 })
  })
})

describe("google_drive_upload under encrypt_dirs: what it takes", () => {
  test("no recipient is forbidden, before any request", async () => {
    const h = await fixture({ recipients: [] })
    const error = await toolError(h.upload(secretArgs(h)))
    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("age_recipients")
    expect(h.calls()).toEqual([])
  })

  test("an invalid recipient is invalid_argument naming its place and not the entry, before any request", async () => {
    const h = await fixture({ recipients: [RECIPIENT, "not-a-key-but-quite-a-long-entry-that-must-not-be-echoed"] })
    const error = await toolError(h.upload(secretArgs(h)))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("Entry 2 of 2 in the age_recipients setting")
    expect(error.message).not.toContain("not-a-key")
    expect(h.calls()).toEqual([])
  })

  test("a file outside the encryption directories needs neither recipients nor age", async () => {
    const h = await fixture({ recipients: [], age: null })
    expect((await h.describe(openArgs(h))).headline?.values?.name).toBe("open.txt")
  })

  test("age missing is upstream_error telling to install it, before any request", async () => {
    const h = await fixture({ age: null })
    const error = await toolError(h.upload(secretArgs(h)))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("age is not installed")
    expect(error.message).toContain("encrypt_dirs")
    expect(h.calls()).toEqual([])
  })

  test("age that does not run is upstream_error, before any request", async () => {
    const h = await fixture({ age: `echo "no such feature" >&2\nexit 2` })
    const error = await toolError(h.upload(secretArgs(h)))
    expect([error.code, error.message]).toEqual(["upstream_error", "age does not run: no such feature"])
    expect(h.calls()).toEqual([])
  })

  test("the plan asks age for its version and nothing more", async () => {
    const h = await fixture()
    await h.describe(secretArgs(h))
    expect(await renderCalls(h.bin)).toEqual(["age --version"])
  })

  test("the target is any when encrypting cannot be planned", async () => {
    const h = await fixture({ recipients: [] })
    expect(await h.targets(secretArgs(h))).toEqual(["*"])
    const ok = await fixture()
    expect(await ok.targets(secretArgs(ok))).toHaveLength(1)
  })
})
