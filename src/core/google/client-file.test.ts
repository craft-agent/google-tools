import { describe, expect, test } from "bun:test"
import { parseClientFile } from "./client-file"

const WHAT = "The client file"
const CLIENT_ID = "made-up-client.apps.example"
const CLIENT_SECRET = "madeUpClientSecret-CCCC987654"

function failureOf(run: () => unknown): { code?: string; message: string } {
  try {
    run()
  } catch (error) {
    return error as { code?: string; message: string }
  }
  throw new Error("expected the call to throw")
}

describe("parseClientFile", () => {
  test("reads the id and secret of a Desktop app client and ignores the rest", () => {
    const text = JSON.stringify({
      installed: {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        project_id: "made-up-project",
        auth_uri: "https://accounts.example.test/auth",
        redirect_uris: ["http://localhost"],
      },
    })

    expect(parseClientFile(text, WHAT)).toEqual({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET })
  })

  test("refuses a Web application client with the way to get the right one", () => {
    const text = JSON.stringify({ web: { client_id: CLIENT_ID, client_secret: CLIENT_SECRET } })

    const error = failureOf(() => parseClientFile(text, WHAT))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe(
      `${WHAT} is a Web application client; create a Desktop app client and download its JSON.`,
    )
  })

  test.each([
    ["not JSON", `{ "installed": ${CLIENT_SECRET}`],
    ["an array", "[]"],
    ["null", "null"],
    ["without installed", JSON.stringify({ other: {} })],
    ["installed that is not an object", JSON.stringify({ installed: CLIENT_SECRET })],
    ["without client_id", JSON.stringify({ installed: { client_secret: CLIENT_SECRET } })],
    ["with an empty client_secret", JSON.stringify({ installed: { client_id: CLIENT_ID, client_secret: "" } })],
    [
      "with a client_id that is a number",
      JSON.stringify({ installed: { client_id: 1, client_secret: CLIENT_SECRET } }),
    ],
  ])("%s is invalid_argument that never echoes the text", (_name, text) => {
    const error = failureOf(() => parseClientFile(text, WHAT))

    expect(error.code).toBe("invalid_argument")
    expect(error.message.startsWith(WHAT)).toBe(true)
    expect(error.message).not.toContain(CLIENT_SECRET)
    expect(error.message).not.toContain(CLIENT_ID)
  })

  test("names the field that is wrong", () => {
    const text = JSON.stringify({ installed: { client_id: CLIENT_ID } })

    expect(failureOf(() => parseClientFile(text, WHAT)).message).toContain("installed.client_secret")
  })
})
