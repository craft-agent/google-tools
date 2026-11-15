import { describe, expect, test } from "bun:test"
import { EMAIL_SCOPE, OPENID_SCOPE } from "./routes"
import { ACCOUNT_TOOLSET, grantedToolsets, type ToolsetScopes } from "./scopes"

const SHEETS_READ = "https://example.test/auth/sheets.readonly"
const SHEETS_WRITE = "https://example.test/auth/sheets"
const MAIL_READ = "https://example.test/auth/mail.readonly"

const TABLE: Record<string, ToolsetScopes> = {
  [ACCOUNT_TOOLSET]: { read: [], write: [] },
  sheets: { read: [SHEETS_READ], write: [SHEETS_WRITE] },
  mail: { read: [MAIL_READ], write: [] },
}

const IDENTITY = [OPENID_SCOPE, EMAIL_SCOPE]

describe("grantedToolsets", () => {
  test("the account toolset needs both identity scopes and nothing else", () => {
    expect(grantedToolsets(IDENTITY, TABLE)).toEqual({ toolsets: [ACCOUNT_TOOLSET], readOnly: [] })
    expect(grantedToolsets([OPENID_SCOPE], TABLE).toolsets).toEqual([])
    expect(grantedToolsets([], TABLE).toolsets).toEqual([])
  })

  test("a toolset is covered when its read scopes are all held, in the table's order", () => {
    expect(grantedToolsets([MAIL_READ, SHEETS_READ, ...IDENTITY], TABLE).toolsets).toEqual([
      ACCOUNT_TOOLSET,
      "sheets",
      "mail",
    ])
    expect(grantedToolsets([SHEETS_WRITE, MAIL_READ], TABLE).toolsets).toEqual(["mail"])
  })

  test("a toolset whose write scopes are not all held is read only", () => {
    expect(grantedToolsets([SHEETS_READ, ...IDENTITY], TABLE).readOnly).toEqual(["sheets"])
    expect(grantedToolsets([SHEETS_READ, SHEETS_WRITE, ...IDENTITY], TABLE).readOnly).toEqual([])
  })

  test("a toolset with no write scopes is never read only", () => {
    expect(grantedToolsets([MAIL_READ, ...IDENTITY], TABLE)).toEqual({
      toolsets: [ACCOUNT_TOOLSET, "mail"],
      readOnly: [],
    })
  })

  test("the package's own table has the account toolset", () => {
    expect(grantedToolsets(IDENTITY).toolsets).toEqual([ACCOUNT_TOOLSET])
  })
})
