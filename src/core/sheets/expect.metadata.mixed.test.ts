import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { MAX_EXPECT } from "./expect"
import { guardHandlers, holds } from "./metadata.testing"
import { BATCH_GET_URL, SHEETS_CREDENTIAL, SPREADSHEET_ID, SPREADSHEET_URL, cleanUp, freshTokens } from "./read.testing"
import { googleSheetsRestructure } from "./restructure"
import { METADATA_SEARCH_URL, UPDATE_URL, writeFixture, writesOf } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

describe("expect with metadata: mixed with values, and in the other tools", () => {
  test("checks the values first and the marks second, both before the write, and lists differences in the order of the guards", async () => {
    const h = await writeFixture(guardHandlers())

    const error = await toolError(
      h.edit(
        holds(
          { range: "Plan!A1", value: "Name" },
          { range: "Plan!A13", metadata: { key: "order" } },
          { range: "Plan!A2", value: "" },
          { range: "Plan!A12", metadata: { key: "order" } },
        ),
      ),
    )

    expect(h.names()).toEqual([`GET ${SPREADSHEET_URL}`, `GET ${BATCH_GET_URL}`, `POST ${METADATA_SEARCH_URL}`])
    expect(error.details).toEqual({
      differs: [
        { range: "Plan!A1", expected: "Name", found: "Total" },
        { range: "Plan!A13", expected: "order", found: "rows 5, 12 carry it" },
      ],
    })
    expect(writesOf(h.requests)).toEqual([])
  })

  test("reads the guarded values only for value guards, before the search, and the cells the edit replaces last", async () => {
    const marksOnly = await writeFixture(guardHandlers())
    await marksOnly.edit(holds({ range: "Plan!A12", metadata: { key: "order" } }))
    expect(marksOnly.names().filter((name) => name === `GET ${BATCH_GET_URL}`)).toHaveLength(1)

    const mixed = await writeFixture(guardHandlers())
    await mixed.edit(holds({ range: "Plan!A1", value: "Total" }, { range: "Plan!A12", metadata: { key: "order" } }))
    expect(mixed.names()).toEqual([
      `GET ${SPREADSHEET_URL}`,
      `GET ${BATCH_GET_URL}`,
      `POST ${METADATA_SEARCH_URL}`,
      `GET ${BATCH_GET_URL}`,
      `POST ${UPDATE_URL}`,
    ])
  })

  test("takes 200 guards of both kinds in all, and 201 are refused", async () => {
    const guards = (count: number) =>
      Array.from({ length: count }, (_, position) =>
        position % 2 === 0 ? { range: "Plan!A1", value: "Total" } : { range: "Plan!A12", metadata: { key: "order" } },
      )
    const h = await writeFixture(guardHandlers())

    await h.edit(holds(...guards(MAX_EXPECT)))
    await expect(h.edit(holds(...guards(MAX_EXPECT + 1)))).rejects.toMatchObject({ code: "invalid_argument" })

    expect(writesOf(h.requests)).toHaveLength(1)
  })

  test("counts both kinds in the Checks fact of the prompt", async () => {
    const h = await writeFixture(guardHandlers())

    const description = await googleSheetsRestructure.describe!(
      googleSheetsRestructure.input.parse({
        spreadsheet: SPREADSHEET_ID,
        operations: [{ op: "delete", range: "Plan!5:5" }],
        expect: [
          { range: "Plan!A1", value: "Total" },
          { range: "Plan!A5", metadata: { key: "order" } },
        ],
      }),
      h.ctx,
    )

    expect(description.facts).toContainEqual({
      label: "Checks",
      value: { text: "{count} checks", values: { count: 2 } },
    })
  })

  test("guards a clear, a restructure and a transform the same way", async () => {
    const guard = { range: "Plan!A13", metadata: { key: "order" } }
    const calls: ((h: Awaited<ReturnType<typeof writeFixture>>) => Promise<unknown>)[] = [
      (h) => h.clear({ spreadsheet: SPREADSHEET_ID, ranges: ["Plan!A1:C9"], expect: [guard] }),
      (h) =>
        h.restructure({
          spreadsheet: SPREADSHEET_ID,
          operations: [{ op: "delete", range: "Plan!5:5" }],
          expect: [guard],
        }),
      (h) =>
        h.transform({
          spreadsheet: SPREADSHEET_ID,
          operations: [{ op: "trim", range: "Plan!A1:B2" }],
          expect: [guard],
        }),
    ]
    for (const run of calls) {
      const h = await writeFixture(guardHandlers())

      expect((await toolError(run(h))).code).toBe("stale")
      expect(writesOf(h.requests)).toEqual([])
    }
  })

  test("is refused for a label that cannot write, before any request", async () => {
    const h = await writeFixture(guardHandlers(), SHEETS_CREDENTIAL)

    const error = await toolError(h.edit(holds({ range: "Plan!A12", metadata: { key: "order" } })))

    expect(error.code).toBe("unauthenticated")
    expect(h.requests).toEqual([])
  })
})

describe("expect with metadata: arguments", () => {
  test.each([
    ["no key", { range: "A1", metadata: {} }],
    ["an empty key", { range: "A1", metadata: { key: "" } }],
    ["an empty value", { range: "A1", metadata: { key: "k", value: "" } }],
    ["a key of 101 characters", { range: "A1", metadata: { key: "k".repeat(101) } }],
    ["a direction that is not one", { range: "A1", metadata: { key: "k" }, along: "tabs" }],
    ["a value and a mark", { range: "A1", value: "x", metadata: { key: "k" } }],
    ["a mark with an unknown key", { range: "A1", metadata: { key: "k", note: 1 } }],
    ["a range that is not one cell", { range: "Plan!A1:B2", metadata: { key: "k" } }],
  ])("refuses %s, before any request", async (_name, guard) => {
    const h = await writeFixture(guardHandlers())

    await expect(h.edit(holds(guard))).rejects.toMatchObject({ code: "invalid_argument" })
    expect(h.requests).toEqual([])
  })

  test("says what is wrong with a guard in the form it was written in", async () => {
    const h = await writeFixture(guardHandlers())

    const bad = await toolError(h.edit(holds({ range: "Plan!A1:B2", metadata: { key: "k" } })))
    const plain = await toolError(h.edit(holds({ range: "Plan!A1:B2", value: "x" })))
    const noKey = await toolError(h.edit(holds({ range: "A1", metadata: {} })))
    const both = await toolError(h.edit(holds({ range: "A1", value: "x", metadata: { key: "k" } })))

    expect(bad.message).toContain("expect.0.range: must be one cell")
    expect(plain.message).toContain("expect.0.range: must be one cell")
    expect(noKey.message).toContain("expect.0: metadata.key: ")
    expect(both.message).toContain('expect.0: Unrecognized key: "value"')
  })
})
