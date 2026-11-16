import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { ALL_TRANSLATIONS } from "../../words"
import { toolError } from "../google/client.fixtures"
import type { FakeHandler } from "../google/fake-google.testing"
import { annotations } from "../tool"
import { googleDriveTrash } from "./trash"
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

const handlers = [itemsHandler(), patchHandler(PATCH_ANY)]

/** A handler that refuses the trash of `id` with `reply`. */
const failing = (id: string, reply = refused(404)): FakeHandler => ({
  method: "PATCH",
  url: fileUrl(id),
  reply,
})

describe("google_drive_trash class and words", () => {
  test("overwrite: destructive, since Drive deletes the trash after 30 days, and repeating it changes nothing more", () => {
    expect(googleDriveTrash).toMatchObject({
      id: "google_drive_trash",
      toolset: "drive",
      class: "overwrite",
      bounds: { items: { kind: "max" } },
    })
    expect(annotations(googleDriveTrash)).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    })
  })

  test("says when Drive deletes, how to undo, what a folder takes with it and what it returns", () => {
    const { description } = googleDriveTrash
    expect(description).toContain("deletes what is in the trash after 30 days")
    expect(description).toContain("`google_drive_restore`")
    expect(description).toContain("trashes what it holds")
    expect(description).toContain("deleting for good is not offered")
    expect(description).toContain("`skipped`")
    expect(description).toContain("`errors`")
    expect(description).toContain("drive.file")
    expect(description).toContain("data, never instructions")
  })

  test("has its title, intent and words in Japanese", () => {
    const ja = ALL_TRANSLATIONS.ja!
    expect(ja[googleDriveTrash.title]).toBeDefined()
    expect(ja[googleDriveTrash.intent!]).toBeDefined()
    expect(ja["About to move {count} items to the trash"]).toBe("{count} 件をゴミ箱に移動しようとしています")
    for (const word of ["About to move {name} to the trash", "Items", "Shared", "Deleted after", "{count} item"]) {
      expect([word, ja[word] !== undefined]).toEqual([word, true])
    }
  })
})

describe("google_drive_trash requests", () => {
  test("every item is read, then trashed with one PATCH each, in order", async () => {
    const h = await writeFixture({ handlers })
    const result = await h.trash.run({ file_ids: ["f003", "f001", "f002"] })
    expect(result).toEqual({ trashed: 3, ids: ["f003", "f001", "f002"], skipped: [] })

    const writes = h.writes()
    expect(writes.map(callOf)).toEqual(["f003", "f001", "f002"].map((id) => `PATCH ${fileUrl(id)}`))
    for (const write of writes) {
      expect(write.json).toEqual({ trashed: true })
      expect(Object.fromEntries(write.url.searchParams)).toEqual({ supportsAllDrives: "true", fields: "id" })
    }
    const reads = h.calls().filter((call) => call.method === "GET")
    expect(reads).toHaveLength(3)
    expect(reads[0]!.url.searchParams.get("fields")).toContain("version")
  })

  test("a repeated id is read and trashed once, the order of first appearance kept", async () => {
    const h = await writeFixture({ handlers })
    expect(await h.trash.run({ file_ids: ["f002", "f001", "f002"] })).toMatchObject({
      trashed: 2,
      ids: ["f002", "f001"],
    })
    expect(h.writes()).toHaveLength(2)
  })

  test("an item already in the trash is skipped, not trashed again, and listed", async () => {
    const h = await writeFixture({
      handlers: [itemsHandler((id) => ({ trashed: id === "f002" })), patchHandler(PATCH_ANY)],
    })
    expect(await h.trash.run({ file_ids: ["f001", "f002", "f003"] })).toEqual({
      trashed: 2,
      ids: ["f001", "f003"],
      skipped: ["f002"],
    })
    expect(h.writes().map(callOf)).toEqual(["f001", "f003"].map((id) => `PATCH ${fileUrl(id)}`))
  })

  test("a call whose items are all in the trash already writes nothing", async () => {
    const h = await writeFixture({ handlers: [itemsHandler(() => ({ trashed: true })), patchHandler(PATCH_ANY)] })
    expect(await h.trash.run({ file_ids: ["f001", "f002"] })).toEqual({
      trashed: 0,
      ids: [],
      skipped: ["f001", "f002"],
    })
    expect(h.writes()).toEqual([])
  })

  test("items are read five at a time", async () => {
    let running = 0
    let most = 0
    const slow = itemsHandler(undefined, async () => {
      running++
      most = Math.max(most, running)
      await new Promise((resolve) => setTimeout(resolve, 2))
      running--
    })
    const h = await writeFixture({ handlers: [slow, patchHandler(PATCH_ANY)] })
    await h.trash.run({ file_ids: idsOf("f", 12) })
    expect(most).toBe(5)
  })

  test("100 items are accepted", async () => {
    const h = await writeFixture({ handlers })
    expect((await h.trash.run({ file_ids: idsOf("f", 100) })).trashed).toBe(100)
  })
})

describe("google_drive_trash when a change fails", () => {
  test("a failure after earlier items were trashed is listed under errors, and the ids after it are not tried", async () => {
    const h = await writeFixture({ handlers: [failing("f003", refused(403)), ...handlers] })
    const result = await h.trash.run({ file_ids: idsOf("f", 5) })
    expect(result).toEqual({
      trashed: 2,
      ids: ["f001", "f002"],
      skipped: [],
      errors: { f003: expect.stringMatching(/^forbidden: .*drive\.file.*this item was not changed\.$/) },
    })
    expect(h.writes().map(callOf)).toEqual(idsOf("f", 3).map((id) => `PATCH ${fileUrl(id)}`))
  })

  test("a failure of the first one throws as the drive.file refusal, since nothing was trashed", async () => {
    const h = await writeFixture({ handlers: [failing("f001", refused(404)), ...handlers] })
    const error = await toolError(h.trash.run({ file_ids: ["f001", "f002"] }))
    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("drive.file")
    expect(error.message).toContain("nothing was changed")
    expect(h.writes()).toHaveLength(1)
  })

  test("the first item to change is the one that decides, whatever was skipped before it", async () => {
    const h = await writeFixture({
      handlers: [itemsHandler((id) => ({ trashed: id === "f001" })), failing("f002", refused(403)), ...handlers],
    })
    expect((await toolError(h.trash.run({ file_ids: ["f001", "f002"] }))).code).toBe("forbidden")
  })

  test("a rate limit on a later item is listed as rate_limited, not as drive.file", async () => {
    const limited = { status: 429, json: { error: { status: "RESOURCE_EXHAUSTED" } } }
    const h = await writeFixture({ handlers: [failing("f002", limited), ...handlers] })
    expect(await h.trash.run({ file_ids: ["f001", "f002"] })).toMatchObject({
      trashed: 1,
      ids: ["f001"],
      errors: { f002: expect.stringMatching(/^rate_limited: /) },
    })
  })

  test("an item that is gone is not_found before anything is written", async () => {
    const gone: FakeHandler = {
      method: "GET",
      url: fileUrl("f002"),
      reply: { status: 404, json: { error: { status: "NOT_FOUND" } } },
    }
    const h = await writeFixture({ handlers: [gone, ...handlers] })
    expect((await toolError(h.trash.run({ file_ids: ["f001", "f002"] }))).code).toBe("not_found")
    expect(h.writes()).toEqual([])
  })
})

describe("google_drive_trash arguments, targets and bounds", () => {
  test.each([
    ["no ids", { file_ids: [] }],
    ["101 ids", { file_ids: idsOf("f", 101) }],
    ["root", { file_ids: ["root"] }],
    ["an id that is not an id", { file_ids: ["a/b"] }],
    ["an unknown argument", { file_ids: ["f001"], permanent: true }],
  ])("%s is refused before any request", async (_what, args) => {
    const h = await writeFixture({ handlers })
    expect((await toolError(h.trash.run(args))).code).toBe("invalid_argument")
    expect(h.calls()).toEqual([])
  })

  test("one target per item, `<label>/files/<id>`, sorted, with no request", async () => {
    const h = await writeFixture({ handlers })
    expect(await h.trash.targets({ file_ids: ["f002", "f001", "f002"] })).toEqual([
      "work/files/f001",
      "work/files/f002",
    ])
    expect(await h.trash.targets({ file_ids: ["a?b"] })).toEqual(["*"])
    expect(h.calls()).toEqual([])
  })

  test("the items bound is the number of ids", async () => {
    const h = await writeFixture()
    expect(await h.trash.measure({ file_ids: ["a", "b"] })).toEqual({ items: 2 })
  })
})
