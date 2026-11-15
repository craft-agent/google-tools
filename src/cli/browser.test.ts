import { afterEach, describe, expect, test } from "bun:test"
import { chmod, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { openerCommand, openInBrowser } from "./browser"
import { removeTempDirs, tempDir } from "./commands.testing"

afterEach(removeTempDirs)

const URL_WITH_QUERY = "https://accounts.example.test/auth?a=1&b=2"

/** A directory holding an executable `xdg-open` that writes its first argument to `opened` and exits with `code`. */
async function fakeOpener(code: number): Promise<{ bin: string; opened: string }> {
  const dir = await tempDir()
  const opened = join(dir, "opened")
  const script = join(dir, "xdg-open")
  await writeFile(script, `#!/bin/sh\nprintf '%s|%s' "$1" "$SECRET_TOKEN" > "${opened}"\nexit ${code}\n`)
  await chmod(script, 0o755)
  return { bin: dir, opened }
}

describe("openerCommand", () => {
  test("is the platform's own opener", () => {
    expect(openerCommand(URL_WITH_QUERY, "darwin")).toEqual(["open", URL_WITH_QUERY])
    expect(openerCommand(URL_WITH_QUERY, "linux")).toEqual(["xdg-open", URL_WITH_QUERY])
    expect(openerCommand(URL_WITH_QUERY, "win32")).toEqual([
      "cmd",
      "/c",
      "start",
      "",
      "https://accounts.example.test/auth?a=1^&b=2",
    ])
  })
})

describe("openInBrowser", () => {
  test.skipIf(process.platform === "win32")(
    "runs the opener with the URL and nothing of the caller's environment",
    async () => {
      const { bin, opened } = await fakeOpener(0)

      await openInBrowser(URL_WITH_QUERY, { PATH: bin, SECRET_TOKEN: "made-up" }, undefined, "linux")

      expect(await readFile(opened, "utf8")).toBe(`${URL_WITH_QUERY}|`)
    },
  )

  test.skipIf(process.platform === "win32")("fails when the opener does", async () => {
    const { bin } = await fakeOpener(1)

    await expect(openInBrowser(URL_WITH_QUERY, { PATH: bin }, undefined, "linux")).rejects.toThrow(
      "could not open the browser",
    )
  })

  test("fails when there is no opener", async () => {
    await expect(openInBrowser(URL_WITH_QUERY, { PATH: await tempDir() }, undefined, "linux")).rejects.toThrow()
  })
})
