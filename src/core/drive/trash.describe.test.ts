import { createHash } from "node:crypto"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { wholeCallDescription } from "../describe"
import { toolError } from "../google/client.fixtures"
import { googleDriveTrash } from "./trash"
import { SHARED_DRIVE_ID, cleanUp, fileUrl, freshTokens, idsOf, itemsHandler, writeFixture } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

/** What differs between the items of the test that lists them: one others can reach, one in a shared drive, one in the trash and one folder. */
const EXTRA: Record<string, Record<string, unknown>> = {
  f001: { shared: true },
  f002: { driveId: SHARED_DRIVE_ID },
  f003: { trashed: true },
  f004: { mimeType: "application/vnd.google-apps.folder" },
}

const digest = (lines: string[]) => createHash("sha256").update(lines.join("\n")).digest("hex")

describe("google_drive_trash describe", () => {
  test("headlines the count, shows Count and Deleted after, and lists every item with its kind", async () => {
    const h = await writeFixture({ handlers: [itemsHandler()] })
    const description = await h.trash.describe({ file_ids: ["f001", "f002"] })
    expect(description.headline).toEqual({ text: "About to move {count} items to the trash", values: { count: "2" } })
    expect(description.facts).toEqual([
      { label: "Count", value: { text: "{count} items", values: { count: 2 } } },
      { label: "Deleted after", value: { text: "{days} days", values: { days: 30 } } },
    ])
    expect(description.text).toEqual({ label: "Items", body: "File f001 — file\nFile f002 — file" })
  })

  test("one item is named in the headline, and counted in the singular", async () => {
    const h = await writeFixture({
      handlers: [itemsHandler(() => ({ name: "Budget 2026.pdf" }))],
    })
    const description = await h.trash.describe({ file_ids: ["f001"] })
    expect(description.headline).toEqual({
      text: "About to move {name} to the trash",
      values: { name: "Budget 2026.pdf" },
    })
    expect(description.facts[0]).toEqual({ label: "Count", value: { text: "{count} item", values: { count: 1 } } })
  })

  test("says which items others can reach, which are in the trash already, and shows folders as folders", async () => {
    const h = await writeFixture({
      handlers: [itemsHandler((id) => EXTRA[id] ?? {})],
    })
    const description = await h.trash.describe({ file_ids: idsOf("f", 4) })
    expect(description.facts[2]).toEqual({ label: "Shared", value: { text: "{count} items", values: { count: 2 } } })
    expect(description.text?.body.split("\n")).toEqual([
      "File f001 — file, shared",
      "File f002 — file, shared",
      "File f003 — file, already in the trash",
      "File f004 — folder",
    ])
  })

  test("shows no Shared fact when no item is reachable by others", async () => {
    const h = await writeFixture({ handlers: [itemsHandler()] })
    expect((await h.trash.describe({ file_ids: ["f001"] })).facts.map((fact) => fact.label)).toEqual([
      "Count",
      "Deleted after",
    ])
  })

  test("an item's name on several lines stays on one", async () => {
    const h = await writeFixture({ handlers: [itemsHandler(() => ({ name: "a\nb   c" }))] })
    expect((await h.trash.describe({ file_ids: ["f001"] })).text?.body).toBe("a b c — file")
  })

  test("all 100 items are listed", async () => {
    const h = await writeFixture({ handlers: [itemsHandler()] })
    const lines = (await h.trash.describe({ file_ids: idsOf("f", 100) })).text!.body.split("\n")
    expect(lines).toHaveLength(100)
    expect(lines.at(-1)).toBe("File f100 — file")
  })

  test("is a description the prompt can use: well formed, with its pin", async () => {
    const h = await writeFixture({ handlers: [itemsHandler()] })
    const whole = await wholeCallDescription(googleDriveTrash, { file_ids: ["f001", "f002"] }, h.ctx)
    expect(whole?.pins).toEqual({ items: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect(whole?.facts).toHaveLength(2)
  })
})

describe("google_drive_trash pins", () => {
  test("pins one digest of every id with its version, in the order given", async () => {
    const h = await writeFixture({ handlers: [itemsHandler()] })
    expect((await h.trash.describe({ file_ids: ["f002", "f001"] })).pins).toEqual({
      items: digest(["f002:7", "f001:7"]),
    })
  })

  test("the pin changes when an item does, since its version does, and is the same for the same state", async () => {
    const pinFor = async (version: string) =>
      (
        await (
          await writeFixture({ handlers: [itemsHandler((id) => ({ version: id === "f002" ? version : "7" }))] })
        ).trash.describe({
          file_ids: ["f001", "f002"],
        })
      ).pins
    const before = await pinFor("7")
    expect(await pinFor("7")).toEqual(before)
    expect(await pinFor("8")).not.toEqual(before)
  })
})

describe("google_drive_trash describe throws where execute would", () => {
  test("an item that is gone and a bad id", async () => {
    const gone = await writeFixture({
      handlers: [
        { method: "GET", url: fileUrl("f001"), reply: { status: 404, json: { error: { status: "NOT_FOUND" } } } },
      ],
    })
    expect((await toolError(gone.trash.describe({ file_ids: ["f001"] }))).code).toBe("not_found")
    const bad = await writeFixture()
    expect((await toolError(bad.trash.describe({ file_ids: ["root"] }))).code).toBe("invalid_argument")
  })
})
