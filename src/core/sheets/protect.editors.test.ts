import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { ME, HEADER, LOCKED, protectHandlers, refusedProtect, sendProtect } from "./protect.testing"
import { SPREADSHEET_ID, cleanUp, freshTokens } from "./read.testing"
import { writeFixture } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const addresses = (count: number) => Array.from({ length: count }, (_, index) => `user${index}@example.test`)

/** A call the arguments' own checks refuse, which reaches no Google: returns the error and the number of requests made. */
async function refusedByArguments(operations: unknown[]) {
  const h = await writeFixture(protectHandlers({}))
  const error = await toolError(h.protect({ spreadsheet: SPREADSHEET_ID, operations }))
  return { error, requests: h.requests.length }
}

describe("google_sheets_protect: editors", () => {
  test.each([
    ["no @", "ann.example.test"],
    ["a space", "ann smith@example.test"],
    ["no dot in the domain", "ann@example"],
    ["a one-letter top-level domain", "ann@example.t"],
    ["a comma", "ann@example.test,bob@example.test"],
    ["an angle bracket", "<ann@example.test>"],
    ["a quote", "an'n@example.test"],
    ["a local part of 65 characters", `${"a".repeat(65)}@example.test`],
    ["more than 100 characters", `a@${"b".repeat(95)}.test`],
    ["nothing", "  "],
  ])("refuses an editor with %s, before any request", async (_name, address) => {
    const { error, requests } = await refusedByArguments([{ op: "protect", range: "Plan", editors: [address] }])

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("editors")
    expect(requests).toBe(0)
  })

  test("refuses an address that is not one in add_editors and remove_editors too", async () => {
    const add = await refusedByArguments([{ op: "protect_update", protection: 7, add_editors: ["nobody"] }])
    const remove = await refusedByArguments([{ op: "protect_update", protection: 7, remove_editors: ["nobody"] }])

    expect([add.error.code, add.requests]).toEqual(["invalid_argument", 0])
    expect([remove.error.code, remove.requests]).toEqual(["invalid_argument", 0])
  })

  test("takes up to 10 addresses in a list and refuses more, repeated ones counting too", async () => {
    const { body } = await sendProtect([{ op: "protect", range: "Plan", editors: addresses(10) }])
    const protect = (editors: string[]) => refusedByArguments([{ op: "protect", range: "Plan", editors }])
    const repeated = [...addresses(10), "user0@example.test"]

    expect(body.requests[0]!.addProtectedRange.protectedRange.editors.users).toEqual(addresses(10))
    expect((await protect(addresses(11))).error.message).toContain("editors")
    expect((await protect(repeated)).requests).toBe(0)
    expect(
      (await refusedByArguments([{ op: "protect_update", protection: 7, add_editors: addresses(11) }])).requests,
    ).toBe(0)
  })

  test("keeps an address once, whatever its letters", async () => {
    const { body } = await sendProtect([
      { op: "protect", range: "Plan", editors: ["Ann@example.test", "ann@EXAMPLE.test", "bob@example.test"] },
      { op: "protect_update", protection: 7, editors: ["B@example.test", "b@example.test"] },
    ])

    expect(body.requests[0]!.addProtectedRange.protectedRange.editors).toEqual({
      users: ["ann@example.test", "bob@example.test"],
    })
    expect(body.requests[1]!.updateProtectedRange.protectedRange.editors).toEqual({ users: ["b@example.test"] })
  })

  test("an empty list leaves only the account, which Google always keeps", async () => {
    const { body } = await sendProtect([{ op: "protect", range: "Plan!A1", editors: [] }])

    expect(body.requests[0]!.addProtectedRange.protectedRange.editors).toEqual({ users: [] })
  })
})

describe("google_sheets_protect: add_editors and remove_editors", () => {
  test("adds the addresses the protection lacks to its editors, keeping its groups and the domain's access", async () => {
    const { body } = await sendProtect([
      { op: "protect_update", protection: "Locked", add_editors: ["Carol@example.test", "BOB@example.test"] },
    ])

    expect(body.requests).toEqual([
      {
        updateProtectedRange: {
          protectedRange: {
            protectedRangeId: 9,
            editors: {
              users: [ME, "bob@example.test", "carol@example.test"],
              groups: ["team@example.test"],
              domainUsersCanEdit: true,
            },
          },
          fields: "editors",
        },
      },
    ])
  })

  test("removes addresses whatever their letters, and adds after removing", async () => {
    const { body } = await sendProtect([
      { op: "protect_update", protection: "Locked", remove_editors: ["Bob@example.test", "nobody@example.test"] },
      {
        op: "protect_update",
        protection: "Header",
        add_editors: ["dan@example.test"],
        remove_editors: ["ann@example.test"],
      },
    ])

    expect(body.requests.map((request) => request.updateProtectedRange.protectedRange.editors)).toEqual([
      { users: [ME], groups: ["team@example.test"], domainUsersCanEdit: true },
      { users: [ME, "dan@example.test"] },
    ])
  })

  test("builds on the list an earlier operation of the call left", async () => {
    const { body } = await sendProtect([
      { op: "protect_update", protection: "Header", editors: ["x@example.test"] },
      { op: "protect_update", protection: "Header", add_editors: ["y@example.test"] },
    ])

    expect(body.requests[1]!.updateProtectedRange.protectedRange.editors).toEqual({
      users: ["x@example.test", "y@example.test"],
    })
  })

  test("refuses them on a protection that only warns, which has no editors", async () => {
    const error = await refusedProtect([{ op: "protect_update", protection: 8, add_editors: ["a@example.test"] }])

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("only warns")
  })

  test("refuses them on a protection whose editors Google does not show", async () => {
    const hidden = { ...HEADER, editors: undefined }

    const error = await refusedProtect([{ op: "protect_update", protection: 7, remove_editors: [ME] }], {
      protections: [hidden, LOCKED],
    })

    expect(error.message).toContain("does not show the editors")
  })
})

describe("google_sheets_protect: arguments that cannot go together", () => {
  test.each([
    [
      "editors on a protection that only warns",
      { op: "protect", range: "Plan", warning_only: true, editors: [] },
      "warning-only protection has no editors",
    ],
    [
      "added editors on a protection set to warn",
      { op: "protect_update", protection: 7, warning_only: true, add_editors: ["a@example.test"] },
      "warning-only protection has no editors",
    ],
    [
      "turning the warning off with no editors",
      { op: "protect_update", protection: 8, warning_only: false },
      "needs `editors`",
    ],
    [
      "turning the warning off with only added editors",
      { op: "protect_update", protection: 8, warning_only: false, add_editors: ["a@example.test"] },
      "needs `editors`",
    ],
    [
      "editors with added editors",
      { op: "protect_update", protection: 7, editors: [], add_editors: ["a@example.test"] },
      "not both",
    ],
    [
      "an address both added and removed",
      { op: "protect_update", protection: 7, add_editors: ["A@example.test"], remove_editors: ["a@example.test"] },
      "both `add_editors` and `remove_editors`",
    ],
    ["nothing to change", { op: "protect_update", protection: 7 }, "to change"],
    ["an empty add list", { op: "protect_update", protection: 7, add_editors: [] }, "add_editors"],
  ])("refuses %s, before any request", async (_name, operation, message) => {
    const { error, requests } = await refusedByArguments([operation])

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(message)
    expect(requests).toBe(0)
  })
})
