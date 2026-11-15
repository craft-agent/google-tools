import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { writeTargets } from "../targets"
import { MARKS, lookupsOf, mark, onRows, searchHandler } from "./metadata.testing"
import { SHEETS_CREDENTIAL, SPREADSHEET_ID, SPREADSHEET_URL, cleanUp, freshTokens } from "./read.testing"
import { googleSheetsRestructure } from "./restructure"
import { BATCH_UPDATE_URL, METADATA_SEARCH_URL, metadata, post, writeFixture, writesOf } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const BASE = `work/spreadsheets/${SPREADSHEET_ID}`

const handlers = (marks = MARKS) => [metadata(), searchHandler(marks), post(BATCH_UPDATE_URL)]

const call = (...operations: unknown[]) => ({ spreadsheet: SPREADSHEET_ID, operations })

/** Runs a call that succeeds, and returns its result and the one batch it sent. */
async function send(...operations: unknown[]) {
  const h = await writeFixture(handlers())
  const result = await h.restructure(call(...operations))
  const writes = writesOf(h.requests)
  expect(writes).toHaveLength(1)
  return { h, result, body: writes[0]!.json as { requests: unknown[] } }
}

/** Runs a call that is refused, and returns its error once it has checked that nothing was written. */
async function refused(...operations: unknown[]) {
  const h = await writeFixture(handlers())
  const error = await toolError(h.restructure(call(...operations)))
  expect(writesOf(h.requests)).toEqual([])
  return error
}

describe("google_sheets_restructure: metadata_update", () => {
  test("changes what is given, selecting the piece by its id, and names the fields in the mask", async () => {
    const { body } = await send({
      op: "metadata_update",
      metadata_id: 3,
      key: "order_id",
      value: "A-101",
      visibility: "project",
      on: { range: "Plan!20:20" },
    })

    expect(body.requests).toEqual([
      {
        updateDeveloperMetadata: {
          dataFilters: [{ developerMetadataLookup: { metadataId: 3 } }],
          developerMetadata: {
            metadataKey: "order_id",
            metadataValue: "A-101",
            visibility: "PROJECT",
            location: { dimensionRange: { sheetId: 0, dimension: "ROWS", startIndex: 19, endIndex: 20 } },
          },
          fields: "metadataKey,metadataValue,visibility,location",
        },
      },
    ])
  })

  test("sends only the field asked for, and an empty value removes it by leaving it out of the body", async () => {
    const { body } = await send(
      { op: "metadata_update", metadata_id: 6, visibility: "document" },
      { op: "metadata_update", metadata_id: 3, value: "" },
      { op: "metadata_update", metadata_id: 5, on: { tab: "a/b" } },
    )

    expect(body.requests).toEqual([
      {
        updateDeveloperMetadata: {
          dataFilters: [{ developerMetadataLookup: { metadataId: 6 } }],
          developerMetadata: { visibility: "DOCUMENT" },
          fields: "visibility",
        },
      },
      {
        updateDeveloperMetadata: {
          dataFilters: [{ developerMetadataLookup: { metadataId: 3 } }],
          developerMetadata: {},
          fields: "metadataValue",
        },
      },
      {
        updateDeveloperMetadata: {
          dataFilters: [{ developerMetadataLookup: { metadataId: 5 } }],
          developerMetadata: { location: { sheetId: 5 } },
          fields: "location",
        },
      },
    ])
  })

  test("reads the pieces named in one search by their ids, once each, between the tabs and the batch", async () => {
    const { h } = await send(
      { op: "metadata_update", metadata_id: 3, value: "x" },
      { op: "metadata_delete", metadata_id: 5 },
      { op: "metadata_update", metadata_id: 3, key: "k" },
    )

    expect(h.names()).toEqual([`GET ${SPREADSHEET_URL}`, `POST ${METADATA_SEARCH_URL}`, `POST ${BATCH_UPDATE_URL}`])
    const search = h.requests.find((request) => request.url.pathname.endsWith(":search"))!
    expect(lookupsOf(search)).toEqual([{ metadataId: 3 }, { metadataId: 5 }])
  })

  test("plans a later operation on what an earlier one leaves, and lists the lines with the pieces' places", async () => {
    const { result } = await send(
      { op: "metadata_update", metadata_id: 3, key: "order_id", on: { range: "Plan!20:20" } },
      { op: "metadata_update", metadata_id: 3, value: "" },
      { op: "metadata_update", metadata_id: 6, value: "late", visibility: "document" },
    )

    expect(result.applied).toEqual([
      'metadata_update #3 "order"="A-100" on rows Plan!12:12: key to "order_id", moved to rows Plan!20:20',
      'metadata_update #3 "order_id"="A-100" on rows Plan!20:20: no value',
      'metadata_update #6 "stage" (project only) on tab \'My Tab\': value to "late", visibility to document',
    ])
  })

  test.each([
    ["nothing to change", { metadata_id: 3 }],
    ["an empty key", { metadata_id: 3, key: "" }],
    ["a negative id", { metadata_id: -1, key: "x" }],
    ["an id that is not whole", { metadata_id: 1.5, key: "x" }],
    ["a place that is not one", { metadata_id: 3, on: "tab" }],
  ])("refuses %s, before any request", async (_name, operation) => {
    const h = await writeFixture(handlers())

    await expect(h.restructure(call({ op: "metadata_update", ...operation }))).rejects.toMatchObject({
      code: "invalid_argument",
    })
    expect(h.requests).toEqual([])
  })

  test("refuses a new place that is not one row or column", async () => {
    const error = await refused({ op: "metadata_update", metadata_id: 3, on: { range: "Plan!A1:B2" } })

    expect(error.code).toBe("invalid_argument")
  })
})

describe("google_sheets_restructure: metadata_delete", () => {
  test("removes the piece selected by its id, saying where it sat and that its cells stay", async () => {
    const { body, result } = await send({ op: "metadata_delete", metadata_id: 4 })

    expect(body.requests).toEqual([
      { deleteDeveloperMetadata: { dataFilter: { developerMetadataLookup: { metadataId: 4 } } } },
    ])
    expect(result.applied).toEqual(['metadata_delete #4 "order"="A-200" on rows Plan!5:5; the cells it marked stay'])
    expect(result.tabs).toEqual(["Plan"])
  })

  test.each([
    ["an id nobody has", [{ op: "metadata_delete", metadata_id: 99 }]],
    ["an id to update that nobody has", [{ op: "metadata_update", metadata_id: 99, value: "x" }]],
    [
      "a piece an earlier operation deleted",
      [
        { op: "metadata_delete", metadata_id: 3 },
        { op: "metadata_update", metadata_id: 3, value: "x" },
      ],
    ],
    [
      "a piece deleted twice",
      [
        { op: "metadata_delete", metadata_id: 3 },
        { op: "metadata_delete", metadata_id: 3 },
      ],
    ],
  ])("refuses %s, naming the id, with nothing written", async (_name, operations) => {
    const error = await refused(...operations)

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toMatch(/No developer metadata with id (99|3) is visible/)
  })

  test("refuses a piece on a tab an earlier operation deletes", async () => {
    const error = await refused({ op: "tab_delete", tab: "My Tab" }, { op: "metadata_delete", metadata_id: 7 })

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("tab that an earlier operation of the call deletes")
  })

  test("is refused for a label that cannot write, before any request", async () => {
    const h = await writeFixture(handlers(), SHEETS_CREDENTIAL)

    const error = await toolError(h.restructure(call({ op: "metadata_delete", metadata_id: 3 })))

    expect(error.code).toBe("unauthenticated")
    expect(h.requests).toEqual([])
  })
})

describe("google_sheets_restructure: metadata targets and pins", () => {
  const describeCall = (h: Awaited<ReturnType<typeof writeFixture>>, ...operations: unknown[]) =>
    googleSheetsRestructure.describe!(googleSheetsRestructure.input.parse(call(...operations)), h.ctx)

  test("names the tab the piece sits on, and the spreadsheet for one on it or moved onto it", async () => {
    const h = await writeFixture(handlers())
    const targets = (...operations: unknown[]) => writeTargets(googleSheetsRestructure, call(...operations), h.ctx)

    expect(await targets({ op: "metadata_delete", metadata_id: 7 })).toEqual([`${BASE}/sheets/77`])
    expect(await targets({ op: "metadata_delete", metadata_id: 1 })).toEqual([BASE])
    expect(await targets({ op: "metadata_update", metadata_id: 3, value: "x" })).toEqual([`${BASE}/sheets/0`])
    expect(await targets({ op: "metadata_update", metadata_id: 3, on: "spreadsheet" })).toEqual([
      BASE,
      `${BASE}/sheets/0`,
    ])
    expect(await targets({ op: "metadata_update", metadata_id: 3, on: { tab: "My Tab" } })).toEqual([
      `${BASE}/sheets/0`,
      `${BASE}/sheets/77`,
    ])
    expect(await targets({ op: "metadata_delete", metadata_id: 99 })).toEqual(["*"])
  })

  test("pins the definitions of the pieces changed, so a piece that changed since fails as stale", async () => {
    const pinOf = async (marks = MARKS, ...operations: unknown[]) =>
      (await describeCall(await writeFixture(handlers(marks)), ...operations)).pins

    const update = { op: "metadata_update", metadata_id: 3, value: "x" }
    const first = await pinOf(MARKS, update)
    const same = await pinOf(MARKS, update)
    const edited = await pinOf(
      MARKS.map((entry) => (entry.metadataId === 3 ? mark(3, "order", onRows(0, 11, 12), "A-999") : entry)),
      update,
    )
    const other = await pinOf(MARKS, { op: "metadata_delete", metadata_id: 4 })

    expect(first!.objects).toMatch(/^[0-9a-f]{64}$/)
    expect(same!.objects).toBe(first!.objects!)
    expect(edited!.objects).not.toBe(first!.objects!)
    expect(other!.objects).not.toBe(first!.objects!)
  })

  test("describes the call with the facts of a restructure and no cells overwritten", async () => {
    const h = await writeFixture(handlers())

    const description = await describeCall(h, { op: "metadata_delete", metadata_id: 4 })

    expect(description.headline).toEqual({
      text: "About to restructure {tab} in {spreadsheet}",
      values: { tab: "Plan", spreadsheet: "Budget 2027" },
    })
    expect(description.facts[0]).toEqual({
      label: "Overwrites",
      value: { text: "{count} cells", values: { count: 0 } },
    })
    expect(writesOf(h.requests)).toEqual([])
  })
})
