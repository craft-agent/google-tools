import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { CLI } from "../account/read.testing"
import { DRIVE_READ_SCOPE } from "../drive/scopes"
import { CREDENTIAL, toolError } from "../google/client.fixtures"
import { SHEETS_CREDENTIAL, callOf, cleanUp, fixture, freshTokens } from "./read.testing"
import { SHEETS_READ_SCOPE, SHEETS_WRITE_SCOPE } from "./scopes"
import { EXPORT_URL, SHEET1_STEM, pdfHandler, snapshotArgs, snapshotFixture, tabsHandler } from "./snapshot.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

/** The export request's query, as an object. */
function exportQuery(h: Awaited<ReturnType<typeof snapshotFixture>>) {
  const request = h.calls().find((call) => callOf(call) === `GET ${EXPORT_URL}`)
  return Object.fromEntries(request?.url.searchParams ?? [])
}

describe("google_sheets_read snapshot export", () => {
  test("exports the first tab with the default layout and returns the saved paths", async () => {
    const h = await snapshotFixture()

    const result = await h.read(snapshotArgs())

    expect(exportQuery(h)).toEqual({
      format: "pdf",
      gid: "0",
      size: "a4",
      portrait: "false",
      scale: "2",
      gridlines: "true",
      fzr: "true",
      sheetnames: "false",
      printtitle: "false",
      pagenum: "UNDEFINED",
      attachment: "false",
    })
    expect(result).toMatchObject({
      tab: "Sheet1",
      range: null,
      pdf: `${h.downloadDir}/sheet-snapshots/${SHEET1_STEM}.pdf`,
      pages: [],
    })
  })

  test("takes the layout arguments", async () => {
    const h = await snapshotFixture()

    await h.read(snapshotArgs({ fit: "page", paper: "tabloid", portrait: true, gridlines: false }))

    expect(exportQuery(h)).toMatchObject({ size: "tabloid", portrait: "true", scale: "4", gridlines: "false" })
  })

  test.each([
    ["width", "2"],
    ["height", "3"],
    ["page", "4"],
    ["none", "1"],
  ])("fit %s is scale %s", async (fit, scale) => {
    const h = await snapshotFixture()
    await h.read(snapshotArgs({ fit }))
    expect(exportQuery(h).scale).toBe(scale)
  })

  test("a closed block goes out as zero-based, end-exclusive bounds, in whatever corner order", async () => {
    const h = await snapshotFixture()

    const result = await h.read(snapshotArgs({ range: "'Q1 Plan'!$F$40:b2" }))

    expect(exportQuery(h)).toMatchObject({ gid: "42", r1: "1", c1: "1", r2: "40", c2: "6" })
    expect(result).toMatchObject({ tab: "Q1 Plan", range: "'Q1 Plan'!$F$40:b2" })
  })

  test("the tab comes from tab, from the range, or is the first, matched ignoring case", async () => {
    const byTab = await snapshotFixture()
    await byTab.read(snapshotArgs({ tab: "q1 plan" }))
    expect(exportQuery(byTab).gid).toBe("42")

    const byRange = await snapshotFixture()
    await byRange.read(snapshotArgs({ range: "'Q1 Plan'!A1:C3" }))
    expect(exportQuery(byRange).gid).toBe("42")

    const bareRange = await snapshotFixture()
    await bareRange.read(snapshotArgs({ tab: "Q1 Plan", range: "A1:C3" }))
    expect(exportQuery(bareRange)).toMatchObject({ gid: "42", r2: "3", c2: "3" })

    const same = await snapshotFixture()
    await same.read(snapshotArgs({ tab: "Q1 Plan", range: "'q1 plan'!A1:C3" }))
    expect(exportQuery(same).gid).toBe("42")
  })

  test("a range and a tab naming different tabs are refused before any export", async () => {
    const h = await snapshotFixture()

    const error = await toolError(h.read(snapshotArgs({ tab: "Sheet1", range: "'Q1 Plan'!A1:C3" })))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("give one tab")
    expect(h.calls().map(callOf)).not.toContain(`GET ${EXPORT_URL}`)
  })

  test("a tab the spreadsheet lacks is refused, listing its tabs", async () => {
    const h = await snapshotFixture()

    const error = await toolError(h.read(snapshotArgs({ tab: "Nope" })))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("Sheet1, Q1 Plan")
  })

  test.each(["A1", "A:F", "1:5", "A1:F", "Sheet1", "Sheet1!A1", "A0:B2", "'oops!A1:B2"])(
    "the range %p is not a closed block and is refused before any call",
    async (range) => {
      const h = await snapshotFixture()

      const error = await toolError(h.read(snapshotArgs({ range })))

      expect(error.code).toBe("invalid_argument")
      expect(h.calls()).toHaveLength(0)
    },
  )

  test("arguments of other methods are refused, and pages stays within 1 to 10", async () => {
    const h = await snapshotFixture()
    expect((await toolError(h.read(snapshotArgs({ ranges: ["A1"] })))).message).toBe(
      "Method snapshot takes no `ranges`.",
    )
    expect((await toolError(h.read({ method: "view", spreadsheet: "x", pages: 2 }))).message).toBe(
      "Method view takes no `pages`.",
    )
    for (const pages of [0, 11, 1.5]) {
      expect((await toolError(h.read(snapshotArgs({ pages })))).code).toBe("invalid_argument")
    }
  })

  test("a label with the Sheets read scope and drive.readonly exports", async () => {
    const credential = { ...CREDENTIAL, scopes: [...CREDENTIAL.scopes, SHEETS_READ_SCOPE, DRIVE_READ_SCOPE] }
    const h = await fixture([tabsHandler, pdfHandler], credential)
    expect(await h.read(snapshotArgs())).toMatchObject({ tab: "Sheet1" })
  })

  test("a label holding the Sheets read scope only is unauthenticated with zero calls sent", async () => {
    const h = await fixture([tabsHandler, pdfHandler], SHEETS_CREDENTIAL)

    const error = await toolError(h.read(snapshotArgs()))

    const fix = `${CLI} login --account work --toolsets account,sheets,drive,comments --read-only --state-dir ${h.stateDir}`
    expect(error).toMatchObject({
      code: "unauthenticated",
      details: { account: "work", needs: [DRIVE_READ_SCOPE], fix },
    })
    expect(error.message).toBe(
      `Google account "work" was not logged in with a scope this call needs (${DRIVE_READ_SCOPE}). Ask a person to log it in again with: ${fix}`,
    )
    expect(h.calls()).toHaveLength(0)
  })

  test("a label with the Sheets write scope but no drive.readonly is unauthenticated with zero calls sent", async () => {
    const credential = { ...CREDENTIAL, scopes: [...CREDENTIAL.scopes, SHEETS_WRITE_SCOPE] }
    const h = await fixture([tabsHandler, pdfHandler], credential)

    const error = await toolError(h.read(snapshotArgs()))

    expect(error).toMatchObject({
      code: "unauthenticated",
      details: { account: "work", needs: [DRIVE_READ_SCOPE] },
    })
    expect(h.calls()).toHaveLength(0)
  })

  test("a label without a Sheets scope is unauthenticated before any call", async () => {
    const h = await fixture([], CREDENTIAL)
    const error = await toolError(h.read(snapshotArgs()))
    expect(error.code).toBe("unauthenticated")
    expect(h.calls()).toHaveLength(0)
  })
})
