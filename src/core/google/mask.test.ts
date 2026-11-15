import { describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import { MASK, maskError, maskText, maskValue } from "./mask"

const REFRESH = "1//" + "a1B2c3D4e5".repeat(3)
const ACCESS = "ya29.a0" + "x.y-z_9".repeat(4)
const CLIENT_SECRET = "GOCSPX-" + "Ab1_-Cd2Ef"
const API_KEY = "AIza" + "S".repeat(35)

describe("maskText", () => {
  test("masks each credential shape", () => {
    for (const secret of [REFRESH, ACCESS, CLIENT_SECRET, API_KEY]) {
      expect(maskText(`before ${secret} after`)).toBe(`before ${MASK} after`)
    }
  })

  test("keeps `code=` and masks the authorization code in a query", () => {
    expect(maskText("https://localhost/cb?state=s&code=4/0AbCdEfGhIjK&scope=x")).toBe(
      `https://localhost/cb?state=s&code=${MASK}&scope=x`,
    )
  })

  test("leaves text that only looks similar", () => {
    const text = "1//short ya29.short GOCSPX-short AIzaShort code=4/short code=other"
    expect(maskText(text)).toBe(text)
  })

  test("masks every occurrence, call after call", () => {
    const text = `${REFRESH} and ${REFRESH}`
    expect(maskText(text)).toBe(`${MASK} and ${MASK}`)
    expect(maskText(text)).toBe(`${MASK} and ${MASK}`)
  })

  test("masks known values, of any shape, longest first", () => {
    expect(maskText("a secret-token-long b secret", ["secret", "secret-token-long", "", "secret"])).toBe(
      `a ${MASK} b ${MASK}`,
    )
  })
})

describe("maskValue", () => {
  test("masks strings and keys deeply and leaves other values", () => {
    const input = { [REFRESH]: [REFRESH, 1, true, null, { note: `token ${ACCESS}` }], plain: "ok", n: 2 }
    expect(maskValue(input)).toEqual({ [MASK]: [MASK, 1, true, null, { note: `token ${MASK}` }], plain: "ok", n: 2 })
  })

  test("copies rather than mutates", () => {
    const input = { list: [REFRESH] }
    const output = maskValue(input)
    expect(input.list[0]).toBe(REFRESH)
    expect(output).not.toBe(input)
  })

  test("masks known values", () => {
    expect(maskValue({ a: "x-hidden-y" }, ["hidden"])).toEqual({ a: `x-${MASK}-y` })
  })
})

describe("maskError", () => {
  test("a ToolError keeps its code and has message and details masked", () => {
    const error = new ToolError("upstream_error", `failed with ${REFRESH}`, { details: { token: ACCESS, status: 400 } })
    const masked = maskError(error) as ToolError
    expect(masked).toBeInstanceOf(ToolError)
    expect(masked.code).toBe("upstream_error")
    expect(masked.message).toBe(`failed with ${MASK}`)
    expect(masked.details).toEqual({ token: MASK, status: 400 })
  })

  test("a ToolError without details stays without", () => {
    const masked = maskError(new ToolError("forbidden", `no ${REFRESH}`)) as ToolError
    expect(masked.details).toBeUndefined()
  })

  test("masks only the details when the message is clean", () => {
    const masked = maskError(new ToolError("stale", "clean", { details: { k: REFRESH } })) as ToolError
    expect(masked.message).toBe("clean")
    expect(masked.details).toEqual({ k: MASK })
  })

  test("another Error becomes a new Error with the masked message", () => {
    const masked = maskError(new TypeError(`bad ${CLIENT_SECRET}`), [])
    expect(masked).toBeInstanceOf(Error)
    expect((masked as Error).message).toBe(`bad ${MASK}`)
  })

  test("known values are masked in the message", () => {
    expect((maskError(new Error("has hidden"), ["hidden"]) as Error).message).toBe(`has ${MASK}`)
  })

  test("returns the same object when there is nothing to mask", () => {
    const toolError = new ToolError("not_found", "clean", { details: { a: "b" } })
    const plain = new Error("clean")
    expect(maskError(toolError)).toBe(toolError)
    expect(maskError(plain)).toBe(plain)
  })

  test("anything that is not an Error is returned unchanged", () => {
    expect(maskError("text")).toBe("text")
    expect(maskError(undefined)).toBeUndefined()
  })
})
