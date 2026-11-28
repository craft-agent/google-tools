import { describe, expect, test } from "bun:test"
import { PROJECT_PROFILE } from "./profile"
import { parseSettings, settingVariables } from "./settings"
import { failure } from "./settings.testing"

const parse = (argv: string[], env: Record<string, string | undefined> = {}) =>
  parseSettings(argv, env, PROJECT_PROFILE)

const MESSAGE = "--youtube-upload-max-gib must be a whole number from 1 to 256."

describe("the youtube_upload_max_gib setting", () => {
  test("is unset by default, so the tool keeps its own 2 GiB", () => {
    expect(parse([]).options.youtube_upload_max_gib).toBeUndefined()
  })

  test("is a whole number read from --youtube-upload-max-gib", () => {
    expect(parse(["--youtube-upload-max-gib", "64"]).options.youtube_upload_max_gib).toBe(64)
  })

  test("is read from GOOGLE_TOOLS_YOUTUBE_UPLOAD_MAX_GIB, and the flag wins", () => {
    const env = { GOOGLE_TOOLS_YOUTUBE_UPLOAD_MAX_GIB: "8" }
    expect(parse([], env).options.youtube_upload_max_gib).toBe(8)
    expect(parse(["--youtube-upload-max-gib=16"], env).options.youtube_upload_max_gib).toBe(16)
    expect(settingVariables()).toContain("GOOGLE_TOOLS_YOUTUBE_UPLOAD_MAX_GIB")
  })

  test("takes 1 and 256 and refuses a value outside them or a fraction", () => {
    expect(parse(["--youtube-upload-max-gib=1"]).options.youtube_upload_max_gib).toBe(1)
    expect(parse(["--youtube-upload-max-gib=256"]).options.youtube_upload_max_gib).toBe(256)
    for (const value of ["0", "257", "2.5", "-1"]) {
      expect(failure(() => parse([`--youtube-upload-max-gib=${value}`])).message).toBe(MESSAGE)
    }
  })
})
