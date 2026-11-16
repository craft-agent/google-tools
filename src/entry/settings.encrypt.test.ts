import { describe, expect, test } from "bun:test"
import { PROJECT_PROFILE } from "./profile"
import { parseSettings, settingVariables } from "./settings"

const parse = (argv: string[], env: Record<string, string | undefined> = {}) =>
  parseSettings(argv, env, PROJECT_PROFILE)

const RECIPIENT = `age1${"q".repeat(58)}`
const OTHER_RECIPIENT = `age1${"p".repeat(58)}`

describe("the encrypt_dirs setting", () => {
  test("is empty by default, so no file is encrypted for being in a directory", () => {
    expect(parse([]).options.encrypt_dirs).toBeUndefined()
  })

  test("is a list of absolute paths read from --encrypt-dirs", () => {
    expect(parse(["--encrypt-dirs", "/srv/secret,/srv/other"]).options.encrypt_dirs).toEqual([
      "/srv/secret",
      "/srv/other",
    ])
  })

  test("is read from GOOGLE_TOOLS_ENCRYPT_DIRS, and the flag wins", () => {
    const env = { GOOGLE_TOOLS_ENCRYPT_DIRS: "/srv/secret" }
    expect(parse([], env).options.encrypt_dirs).toEqual(["/srv/secret"])
    expect(parse(["--encrypt-dirs=/srv/flag"], env).options.encrypt_dirs).toEqual(["/srv/flag"])
    expect(settingVariables()).toContain("GOOGLE_TOOLS_ENCRYPT_DIRS")
  })

  test("refuses a relative directory", () => {
    expect(() => parse(["--encrypt-dirs=secret"])).toThrow("absolute")
  })
})

describe("the age_recipients setting", () => {
  test("is empty by default", () => {
    expect(parse([]).options.age_recipients).toBeUndefined()
  })

  test("is a list read from --age-recipients, blank items dropped", () => {
    expect(parse(["--age-recipients", `${RECIPIENT}, ,${OTHER_RECIPIENT}`]).options.age_recipients).toEqual([
      RECIPIENT,
      OTHER_RECIPIENT,
    ])
  })

  test("is read from GOOGLE_TOOLS_AGE_RECIPIENTS, and the flag wins", () => {
    const env = { GOOGLE_TOOLS_AGE_RECIPIENTS: RECIPIENT }
    expect(parse([], env).options.age_recipients).toEqual([RECIPIENT])
    expect(parse([`--age-recipients=${OTHER_RECIPIENT}`], env).options.age_recipients).toEqual([OTHER_RECIPIENT])
    expect(settingVariables()).toContain("GOOGLE_TOOLS_AGE_RECIPIENTS")
  })
})
