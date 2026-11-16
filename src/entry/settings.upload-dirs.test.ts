import { describe, expect, test } from "bun:test"
import { PROJECT_PROFILE } from "./profile"
import { parseSettings, settingVariables } from "./settings"

const parse = (argv: string[], env: Record<string, string | undefined> = {}) =>
  parseSettings(argv, env, PROJECT_PROFILE)

describe("the upload_dirs setting", () => {
  test("is empty by default, so no file can be uploaded until a person names a directory", () => {
    expect(parse([]).options.upload_dirs).toBeUndefined()
  })

  test("is a list of absolute paths read from --upload-dirs", () => {
    expect(parse(["--upload-dirs", "/srv/outbox,/srv/other"]).options.upload_dirs).toEqual([
      "/srv/outbox",
      "/srv/other",
    ])
  })

  test("is read from GOOGLE_TOOLS_UPLOAD_DIRS, and the flag wins", () => {
    const env = { GOOGLE_TOOLS_UPLOAD_DIRS: "/srv/outbox" }
    expect(parse([], env).options.upload_dirs).toEqual(["/srv/outbox"])
    expect(parse(["--upload-dirs=/srv/flag"], env).options.upload_dirs).toEqual(["/srv/flag"])
    expect(settingVariables()).toContain("GOOGLE_TOOLS_UPLOAD_DIRS")
  })

  test("refuses a relative directory", () => {
    expect(() => parse(["--upload-dirs=outbox"])).toThrow("absolute")
  })
})
