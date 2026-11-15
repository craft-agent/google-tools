import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { ToolError } from "../core"
import { PROJECT } from "../project"
import { commandLabel, handleCommandError, parseFlagArgs, resolveCommandStateDir } from "./command-args"
import { EXIT_FAILED, EXIT_USAGE } from "./command-io"

const SPEC = { values: ["--account"], switches: ["--yes"] } as const

function collect(env: Record<string, string | undefined> = {}) {
  let stderr = ""
  return { io: { env, stdout: () => {}, stderr: (text: string) => (stderr += text) }, stderr: () => stderr }
}

describe("parseFlagArgs", () => {
  test("takes a value after the flag and after an equals sign", () => {
    expect(parseFlagArgs(["--account", "work"], SPEC).values).toEqual({ "--account": "work" })
    expect(parseFlagArgs(["--account=work"], SPEC).values).toEqual({ "--account": "work" })
  })

  test("takes a switch and leaves everything else in rest, in order", () => {
    const parsed = parseFlagArgs(["--state-dir", "/s", "--yes", "--account", "a", "extra"], SPEC)
    expect(parsed.switches.has("--yes")).toBe(true)
    expect(parsed.rest).toEqual(["--state-dir", "/s", "extra"])
  })

  test.each([
    [["--account"], "--account"],
    [["--account="], "--account"],
    [["--account", "--yes"], "--account"],
    [["--yes=true"], "--yes"],
  ])("%j is a usage error naming the flag", (argv, flag) => {
    expect(() => parseFlagArgs(argv, SPEC)).toThrow(flag)
  })
})

describe("commandLabel", () => {
  test("returns a valid label and refuses another without repeating it", () => {
    expect(commandLabel("work_1")).toBe("work_1")
    expect(() => commandLabel("Work")).toThrow("Invalid label:")
    expect(() => commandLabel("Work")).not.toThrow("Work")
  })
})

describe("resolveCommandStateDir", () => {
  const PREFIX = PROJECT.envPrefix

  test("takes the flag's value, expanding ~ as the settings do", () => {
    expect(resolveCommandStateDir("/flag", collect().io)).toBe("/flag")
    expect(resolveCommandStateDir("~/state", collect({ HOME: "/home/someone" }).io)).toBe("/home/someone/state")
  })

  test("falls back to the environment, then XDG_STATE_HOME, then the home", () => {
    const home = "/home/someone"
    const env = { HOME: home, XDG_STATE_HOME: "/xdg" }
    expect(resolveCommandStateDir(undefined, collect({ ...env, [`${PREFIX}_STATE_DIR`]: "/env" }).io)).toBe("/env")
    expect(resolveCommandStateDir(undefined, collect(env).io)).toBe(join("/xdg", PROJECT.name))
    expect(resolveCommandStateDir(undefined, collect({ HOME: home }).io)).toBe(
      join(home, ".local", "state", PROJECT.name),
    )
  })

  test("lets the flag win over the environment", () => {
    const { io } = collect({ [`${PREFIX}_STATE_DIR`]: "/env" })
    expect(resolveCommandStateDir("/flag", io)).toBe("/flag")
  })

  test("reads no other setting's variable", () => {
    const env = { [`${PREFIX}_UNATTENDED`]: "maybe", [`${PREFIX}_GRANT_KEY`]: "short" }
    expect(resolveCommandStateDir("/flag", collect(env).io)).toBe("/flag")
  })

  test("refuses a relative path", () => {
    expect(() => resolveCommandStateDir("relative", collect().io)).toThrow("--state-dir must be an absolute path.")
  })
})

describe("handleCommandError", () => {
  test("says a tool error on one prefixed line, and picks the exit by mode", () => {
    const error = new ToolError("not_found", "lost")
    const { io, stderr } = collect()
    expect(handleCommandError(error, io)).toBe(EXIT_FAILED)
    expect(stderr()).toBe(`${PROJECT.cli}: lost\n`)
    expect(handleCommandError(error, io, { mode: "usage" })).toBe(EXIT_USAGE)
    expect(handleCommandError(error, io, { mode: "auto" })).toBe(EXIT_FAILED)
    expect(handleCommandError(new ToolError("invalid_argument", "bad"), io, { mode: "auto" })).toBe(EXIT_USAGE)
  })

  test("says a cancellation only when told how, else it is unexpected", () => {
    const abort = Object.assign(new Error("stopped"), { name: "AbortError" })
    const said = collect()
    expect(handleCommandError(abort, said.io, { abortMessage: "Cancelled." })).toBe(EXIT_FAILED)
    expect(said.stderr()).toBe(`${PROJECT.cli}: Cancelled.\n`)
    const unsaid = collect()
    expect(handleCommandError(abort, unsaid.io)).toBe(EXIT_FAILED)
    expect(unsaid.stderr()).toBe(`${PROJECT.cli}: Unexpected error; the command failed.\n`)
  })

  test("says an unexpected error generically, without its message or stack", () => {
    const { io, stderr } = collect()
    expect(handleCommandError(new TypeError("secret detail"), io)).toBe(EXIT_FAILED)
    expect(stderr()).toBe(`${PROJECT.cli}: Unexpected error; the command failed.\n`)
  })
})
