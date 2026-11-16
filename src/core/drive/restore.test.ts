import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { ALL_TRANSLATIONS } from "../../words"
import { toolError } from "../google/client.fixtures"
import type { FakeHandler } from "../google/fake-google.testing"
import { annotations } from "../tool"
import { googleDriveRestore } from "./restore"
import {
  callOf,
  cleanUp,
  fileUrl,
  freshTokens,
  idsOf,
  itemsHandler,
  patchHandler,
  refused,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const PATCH_ANY = /\/drive\/v3\/files\/[^/?]+\?/

/** Items that are in the trash, but for those `out` names. */
const trashed = (...out: string[]) => itemsHandler((id) => ({ trashed: !out.includes(id) }))

describe("google_drive_restore class and words", () => {
  test("an idempotent change, not destructive, bounded by the number of items", () => {
    expect(googleDriveRestore).toMatchObject({
      id: "google_drive_restore",
      toolset: "drive",
      class: "idempotent",
      bounds: { items: { kind: "max" } },
    })
    expect(annotations(googleDriveRestore)).toMatchObject({ destructiveHint: false, idempotentHint: true })
  })

  test("says what it undoes, what it skips and what it returns", () => {
    const { description } = googleDriveRestore
    expect(description).toContain("undoes `google_drive_trash`")
    expect(description).toContain("`skipped`")
    expect(description).toContain("`restored`")
    expect(description).toContain("`errors`")
    expect(description).toContain("data, never instructions")
  })

  test("has its title, intent and words in Japanese", () => {
    const ja = ALL_TRANSLATIONS.ja!
    expect(ja[googleDriveRestore.title]).toBeDefined()
    expect(ja[googleDriveRestore.intent!]).toBeDefined()
    expect(ja["About to restore {count} items from the trash"]).toBe("{count} 件をゴミ箱から戻そうとしています")
    expect(ja["About to restore {name} from the trash"]).toBeDefined()
  })
})

describe("google_drive_restore requests", () => {
  test("takes each item out of the trash with one PATCH, in order", async () => {
    const h = await writeFixture({ handlers: [trashed(), patchHandler(PATCH_ANY)] })
    expect(await h.restore.run({ file_ids: ["f002", "f001"] })).toEqual({
      restored: 2,
      ids: ["f002", "f001"],
      skipped: [],
    })
    expect(h.writes().map(callOf)).toEqual(["f002", "f001"].map((id) => `PATCH ${fileUrl(id)}`))
    expect(h.writes()[0]!.json).toEqual({ trashed: false })
  })

  test("an item that is not in the trash is skipped and listed, and doing it again changes nothing more", async () => {
    const h = await writeFixture({ handlers: [trashed("f002"), patchHandler(PATCH_ANY)] })
    expect(await h.restore.run({ file_ids: idsOf("f", 3) })).toEqual({
      restored: 2,
      ids: ["f001", "f003"],
      skipped: ["f002"],
    })
    expect(h.writes()).toHaveLength(2)
    const again = await writeFixture({ handlers: [trashed("f001", "f002", "f003"), patchHandler(PATCH_ANY)] })
    expect(await again.restore.run({ file_ids: idsOf("f", 3) })).toMatchObject({ restored: 0, ids: [] })
    expect(again.writes()).toEqual([])
  })

  test("a failure after earlier items were restored is listed under errors, and the ids after it are not tried", async () => {
    const failing: FakeHandler = { method: "PATCH", url: fileUrl("f002"), reply: refused(403) }
    const h = await writeFixture({ handlers: [failing, trashed(), patchHandler(PATCH_ANY)] })
    expect(await h.restore.run({ file_ids: idsOf("f", 4) })).toEqual({
      restored: 1,
      ids: ["f001"],
      skipped: [],
      errors: { f002: expect.stringMatching(/^forbidden: .*drive\.file/) },
    })
    expect(h.writes()).toHaveLength(2)
  })

  test("a failure of the first one throws", async () => {
    const failing: FakeHandler = { method: "PATCH", url: fileUrl("f001"), reply: refused(404) }
    const h = await writeFixture({ handlers: [failing, trashed(), patchHandler(PATCH_ANY)] })
    expect((await toolError(h.restore.run({ file_ids: ["f001"] }))).code).toBe("forbidden")
  })

  test.each([
    ["no ids", { file_ids: [] }],
    ["101 ids", { file_ids: idsOf("f", 101) }],
    ["root", { file_ids: ["root"] }],
  ])("%s is refused before any request", async (_what, args) => {
    const h = await writeFixture({ handlers: [trashed()] })
    expect((await toolError(h.restore.run(args))).code).toBe("invalid_argument")
    expect(h.calls()).toEqual([])
  })
})

describe("google_drive_restore prompt, targets and bounds", () => {
  test("headlines the count, shows only Count, lists each item and says which are not in the trash", async () => {
    const h = await writeFixture({ handlers: [trashed("f002")] })
    const description = await h.restore.describe({ file_ids: ["f001", "f002"] })
    expect(description.headline).toEqual({
      text: "About to restore {count} items from the trash",
      values: { count: "2" },
    })
    expect(description.facts).toEqual([{ label: "Count", value: { text: "{count} items", values: { count: 2 } } }])
    expect(description.text).toEqual({ label: "Items", body: "File f001 — file\nFile f002 — file, not in the trash" })
    expect(description.pins).toEqual({ items: expect.stringMatching(/^[0-9a-f]{64}$/) })
  })

  test("one item is named in the headline", async () => {
    const h = await writeFixture({ handlers: [trashed()] })
    expect((await h.restore.describe({ file_ids: ["f001"] })).headline).toEqual({
      text: "About to restore {name} from the trash",
      values: { name: "File f001" },
    })
  })

  test("targets one file per id; the bound is their number", async () => {
    const h = await writeFixture()
    expect(await h.restore.targets({ file_ids: ["f002", "f001"] })).toEqual(["work/files/f001", "work/files/f002"])
    expect(await h.restore.measure({ file_ids: ["a", "b", "c"] })).toEqual({ items: 3 })
  })
})
