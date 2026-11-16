import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { ME, HEADER, LOCKED, PROTECTIONS, sendProtect } from "./protect.testing"
import { SPREADSHEET_ID, SPREADSHEET_URL, answer, cleanUp, fixture, freshTokens } from "./read.testing"
import { PLAN_GRID } from "./structure.testing"
import { BATCH_UPDATE_URL } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const people = (count: number) => Array.from({ length: count }, (_, index) => `user${index}@example.test`)

/** The protection `Header` as Google reports it once it has these editors. */
const headerWith = (editors: object) => ({ ...HEADER, editors })

/** What Google answers for an `addProtectedRange` of `protectedRange`. */
const added = (protectedRange: object) => ({ replies: [{ addProtectedRange: { protectedRange } }] })

const NEW = {
  protectedRangeId: 300,
  range: PLAN_GRID(0, 5, 0, 3),
  description: "Budget",
  editors: { users: [ME, "ann@example.test"] },
  requestingUserCanEdit: true,
}

describe("google_sheets_protect: the result", () => {
  test("lists every protection the call added or changed with every editor Google reports once the batch is in, past 10", async () => {
    const everyone = [ME, ...people(11)]
    const { result } = await sendProtect([{ op: "protect_update", protection: "Header", add_editors: people(10) }], {
      after: [
        headerWith({ users: everyone, groups: ["a@example.test", "b@example.test"], domainUsersCanEdit: true }),
        ...PROTECTIONS.slice(1),
      ],
    })

    expect(result.protections).toEqual([
      {
        protection_id: 7,
        range: "Plan!A1:F1",
        label: "Header",
        warning_only: false,
        editors: {
          users: everyone,
          groups: ["a@example.test", "b@example.test"],
          domain_users_can_edit: true,
        },
      },
    ])
    expect(result.protections[0].editors.users).toHaveLength(12)
    expect(result.deleted).toEqual([])
    expect(result.errors).toBeUndefined()
  })

  test("names the protection a call added by the id Google answered, and lists the changed ones in the order of the operations", async () => {
    const { result } = await sendProtect(
      [
        { op: "protect_update", protection: "Locked", label: "Sealed" },
        { op: "protect", range: "Plan!A1:C5", label: "Budget", editors: ["ann@example.test"] },
        { op: "protect_delete", protection: "Header" },
      ],
      {
        reply: { replies: [{}, { addProtectedRange: { protectedRange: NEW } }, {}] },
        after: [{ ...LOCKED, description: "Sealed" }, NEW],
      },
    )

    expect(result.applied).toEqual([
      'protect_update #9 "Locked": labelled "Sealed"; editors: me@example.test, bob@example.test, team@example.test (group), everyone in the domain',
      'protect Plan!A1:C5; labelled "Budget"; editors: you (the account), ann@example.test',
      'protect_delete #7 "Header" (Plan!A1:F1; any other protection over those cells still applies)',
    ])
    expect(result.protections.map((protection: any) => [protection.protection_id, protection.label])).toEqual([
      [9, "Sealed"],
      [300, "Budget"],
    ])
    expect(result.protections[1].editors).toEqual({
      users: [ME, "ann@example.test"],
      groups: [],
      domain_users_can_edit: false,
    })
    expect(result.deleted).toEqual([7])
  })

  test("reads the protected ranges back once, of the tabs the call touched, after the batch", async () => {
    const { h } = await sendProtect(
      [
        { op: "protect_update", protection: "Header", label: "Top" },
        { op: "protect_update", protection: 8, warning_only: false, editors: [] },
      ],
      {},
    )

    expect(h.names()).toEqual([
      `GET ${SPREADSHEET_URL}`,
      `GET ${SPREADSHEET_URL}`,
      `POST ${BATCH_UPDATE_URL}`,
      `GET ${SPREADSHEET_URL}`,
    ])
    const read = h.calls()[3]!.url.searchParams
    expect(read.getAll("ranges")).toEqual(["Plan", "'My Tab'"])
    expect(read.get("fields")).toBe(
      "sheets(properties(sheetId),protectedRanges(protectedRangeId,range,unprotectedRanges,description,warningOnly,editors(users,groups,domainUsersCanEdit),requestingUserCanEdit))",
    )
    expect(read.has("includeGridData")).toBe(false)
  })

  test("reads nothing back for a call that only deletes, and lists the ids it removed once each", async () => {
    const { h, result } = await sendProtect([
      { op: "protect_delete", protection: 7 },
      { op: "protect_delete", protection: "Locked" },
    ])

    expect(h.names()).toEqual([`GET ${SPREADSHEET_URL}`, `GET ${SPREADSHEET_URL}`, `POST ${BATCH_UPDATE_URL}`])
    expect(result).toEqual({
      spreadsheet_id: SPREADSHEET_ID,
      applied: expect.any(Array),
      protections: [],
      deleted: [7, 9],
    })
  })
})

describe("google_sheets_protect: when the read-back fails after the write", () => {
  test("keeps what was created, says so under `errors` and does not throw", async () => {
    const { h, result } = await sendProtect(
      [{ op: "protect", range: "Plan!A1:C5", label: "Budget", editors: ["ann@example.test"] }],
      { reply: added(NEW), after: null },
    )

    expect(result.protections).toEqual([
      {
        protection_id: 300,
        range: "Plan!A1:C5",
        label: "Budget",
        warning_only: false,
        editors: { users: [ME, "ann@example.test"], groups: [], domain_users_can_edit: false },
      },
    ])
    expect(result.errors).toEqual({ protections: expect.stringMatching(/^upstream_error: /) })
    expect(h.calls().filter((call) => call.method === "POST")).toHaveLength(1)
  })

  test("lists no protection it only changed, since nothing tells what Google holds now, but names the failure", async () => {
    const { result } = await sendProtect([{ op: "protect_update", protection: 7, label: "Top" }], { after: null })

    expect(result.protections).toEqual([])
    expect(result.errors.protections).toStartWith("upstream_error: ")
    expect(result.applied).toHaveLength(1)
  })

  test("says so when Google answers an added protection with no id, which cannot be read back", async () => {
    const { result } = await sendProtect([{ op: "protect", range: "Plan!A1" }], { reply: { replies: [{}] } })

    expect(result.protections).toEqual([])
    expect(result.errors.protection_id).toContain("did not report the id")
  })
})

describe("google_sheets_read structure: protections", () => {
  test("lists every editor in full, past 10, with the groups, the domain's access and whether the account may edit", async () => {
    const users = people(14)
    const h = await fixture([
      answer(SPREADSHEET_URL, {
        sheets: [
          {
            properties: { sheetId: 0, title: "Plan" },
            protectedRanges: [
              {
                protectedRangeId: 7,
                range: PLAN_GRID(0, 1, 0, 6),
                editors: { users, groups: ["a@example.test", "b@example.test"], domainUsersCanEdit: true },
                requestingUserCanEdit: true,
              },
              { protectedRangeId: 8, range: { sheetId: 0 }, editors: { users: [ME] } },
            ],
          },
        ],
      }),
    ])

    const { structure } = await h.read({ method: "structure", spreadsheet: SPREADSHEET_ID })

    expect(structure![0]!.protections).toEqual([
      expect.objectContaining({
        protection_id: 7,
        editors: { users, groups: ["a@example.test", "b@example.test"], domain_users_can_edit: true },
        can_edit: true,
      }),
      expect.objectContaining({
        protection_id: 8,
        editors: { users: [ME], groups: [], domain_users_can_edit: false },
        can_edit: false,
      }),
    ])
  })
})
