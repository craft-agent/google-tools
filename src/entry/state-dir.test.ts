import { describe, expect, test } from "bun:test"
import { homedir } from "node:os"
import { join } from "node:path"
import {
  parseSettings,
  parseStateDirOnly,
  parseTargetSettings,
  parseToolSettings,
  settingsFromOptions,
} from "./settings"
import { DEFAULT_STATE, failure, profile } from "./settings.testing"

const HOME = "/home/someone"
const DEFAULT_IN_HOME = join(HOME, ".local", "state", profile.name)

describe("the state_dir setting", () => {
  test("defaults to the profile's name under the user's state home", () => {
    expect(parseSettings([], {}, profile).state_dir).toBe(DEFAULT_STATE.state_dir)
    expect(DEFAULT_STATE.state_dir).toBe(join(homedir(), ".local", "state", profile.name))
  })

  test("defaults under an absolute HOME", () => {
    expect(parseSettings([], { HOME }, profile).state_dir).toBe(DEFAULT_IN_HOME)
  })

  test("defaults under an absolute XDG_STATE_HOME and ignores a relative one", () => {
    expect(parseSettings([], { HOME, XDG_STATE_HOME: "/xdg/state" }, profile).state_dir).toBe(
      join("/xdg/state", profile.name),
    )
    expect(parseSettings([], { HOME, XDG_STATE_HOME: "relative/state" }, profile).state_dir).toBe(DEFAULT_IN_HOME)
  })

  test("a flag names it, expanding ~ and beating the environment", () => {
    const env = { HOME, DEMO_STATE_DIR: "/env/state" }
    expect(parseSettings(["--state-dir", "/flag/state"], env, profile).state_dir).toBe("/flag/state")
    expect(parseSettings(["--state-dir=~/mine"], env, profile).state_dir).toBe(join(HOME, "mine"))
    expect(parseSettings([], env, profile).state_dir).toBe("/env/state")
  })

  test("a blank value is unset", () => {
    expect(parseSettings([], { HOME, DEMO_STATE_DIR: " " }, profile).state_dir).toBe(DEFAULT_IN_HOME)
  })

  test("a relative value is invalid_argument", () => {
    expect(failure(() => parseSettings(["--state-dir", "relative"], {}, profile)).message).toContain("--state-dir")
    expect(failure(() => parseSettings([], { DEMO_STATE_DIR: "relative" }, profile)).message).toContain(
      "DEMO_STATE_DIR",
    )
    expect(failure(() => settingsFromOptions({ state_dir: "relative" }, {}, profile)).message).toContain("state_dir")
  })

  test("the tool and target commands read it too", () => {
    expect(parseToolSettings(["--state-dir", "/flag/state"], {}, profile).state_dir).toBe("/flag/state")
    expect(parseTargetSettings(["--state-dir", "/flag/state"], {}, profile).state_dir).toBe("/flag/state")
    expect(parseTargetSettings([], { HOME }, profile).state_dir).toBe(DEFAULT_IN_HOME)
  })

  test("a plugin option names it, expanding ~ and beating the environment", () => {
    const env = { HOME, DEMO_STATE_DIR: "/env/state" }
    expect(settingsFromOptions({ state_dir: "/option/state" }, env, profile).state_dir).toBe("/option/state")
    expect(settingsFromOptions({ state_dir: "~/mine" }, env, profile).state_dir).toBe(join(HOME, "mine"))
    expect(settingsFromOptions({}, env, profile).state_dir).toBe("/env/state")
    expect(settingsFromOptions(undefined, { HOME }, profile).state_dir).toBe(DEFAULT_IN_HOME)
  })
})

describe("parseStateDirOnly", () => {
  test("reads the flag, else the variable, else the default, and nothing else", () => {
    expect(parseStateDirOnly(["--state-dir", "/flag/state"], { DEMO_STATE_DIR: "/env/state" }, profile)).toEqual({
      state_dir: "/flag/state",
    })
    expect(parseStateDirOnly([], { DEMO_STATE_DIR: "/env/state" }, profile)).toEqual({ state_dir: "/env/state" })
    expect(parseStateDirOnly([], { HOME }, profile)).toEqual({ state_dir: DEFAULT_IN_HOME })
  })

  test("refuses any other flag and ignores the other settings' variables", () => {
    expect(failure(() => parseStateDirOnly(["--read-only"], {}, profile)).message).toContain("--read-only")
    expect(parseStateDirOnly([], { HOME, DEMO_UNATTENDED: "maybe", DEMO_GRANT_KEY: "short" }, profile)).toEqual({
      state_dir: DEFAULT_IN_HOME,
    })
  })
})
