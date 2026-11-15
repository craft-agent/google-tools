import { describe, expect, test } from "bun:test"
import { runConsent } from "./consent"
import { AUTH_CODE, consentOptions, targetOf, until, visit, type Visit } from "./consent.testing"

type Failure = Error & { code: string }

function failureOf(promise: Promise<unknown>): Promise<Failure> {
  return promise.then(
    () => {
      throw new Error("expected the consent to fail")
    },
    (error: unknown) => error as Failure,
  )
}

describe("requests that are not Google's answer", () => {
  test("are refused and ignored while the consent keeps waiting", async () => {
    const seen: Visit[] = []
    const run = consentOptions(undefined, async (url) => {
      const { redirectUri, state } = targetOf(url)
      seen.push(await visit(redirectUri, { state: "wrong-state", code: AUTH_CODE }))
      seen.push(await visit(redirectUri, { code: AUTH_CODE }))
      seen.push(await visit(redirectUri, { state }))
      seen.push(await visit(redirectUri, { state, code: AUTH_CODE }, { path: "/elsewhere" }))
      seen.push(await visit(redirectUri, { state, code: AUTH_CODE }, { method: "POST" }))
      seen.push(await visit(redirectUri, { state, code: AUTH_CODE }))
    })

    const result = await runConsent(run.options)
    await until(() => seen.length === 6)

    expect(seen.map((reply) => reply.status)).toEqual([400, 400, 400, 404, 400, 200])
    expect(run.requests).toHaveLength(1)
    expect(result.refresh_token).not.toBe("")
  })
})

describe("a refusal in the browser", () => {
  test("access_denied is declined", async () => {
    const run = consentOptions(undefined, async (url) => {
      const { redirectUri, state } = targetOf(url)
      await visit(redirectUri, { state, error: "access_denied" })
    })

    const error = await failureOf(runConsent(run.options))

    expect(error.code).toBe("declined")
    expect(error.message).toBe("The consent was declined in the browser.")
    expect(run.requests).toHaveLength(0)
  })

  test("another error is upstream_error naming it", async () => {
    const run = consentOptions(undefined, async (url) => {
      const { redirectUri, state } = targetOf(url)
      await visit(redirectUri, { state, error: "admin_policy_enforced" })
    })

    const error = await failureOf(runConsent(run.options))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("admin_policy_enforced")
  })

  test("an error name that is not a plain word is not repeated", async () => {
    const run = consentOptions(undefined, async (url) => {
      const { redirectUri, state } = targetOf(url)
      await visit(redirectUri, { state, error: "<b>Bad</b> text" })
    })

    const error = await failureOf(runConsent(run.options))

    expect(error.code).toBe("upstream_error")
    expect(error.message).not.toContain("Bad")
  })

  test("an error with the wrong state is ignored", async () => {
    const run = consentOptions(undefined, async (url) => {
      const { redirectUri, state } = targetOf(url)
      await visit(redirectUri, { state: "wrong-state", error: "access_denied" })
      await visit(redirectUri, { state, code: AUTH_CODE })
    })

    expect((await runConsent(run.options)).refresh_token).not.toBe("")
  })
})

describe("when no answer comes", () => {
  test("the time limit is upstream_error and the listener is closed", async () => {
    let redirectUri = ""
    const run = consentOptions(
      undefined,
      async (url) => {
        redirectUri = targetOf(url).redirectUri
      },
      { timeoutMs: 30 },
    )

    const error = await failureOf(runConsent(run.options))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("No answer from the browser within 1 minute.")
    await expect(visit(redirectUri, {})).rejects.toThrow()
  })

  test("a cancellation is the cancelled error and the listener is closed", async () => {
    const controller = new AbortController()
    let redirectUri = ""
    const run = consentOptions(
      undefined,
      async (url) => {
        redirectUri = targetOf(url).redirectUri
        controller.abort()
      },
      { signal: controller.signal },
    )

    const error = await failureOf(runConsent(run.options))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The call was cancelled.")
    await expect(visit(redirectUri, {})).rejects.toThrow()
  })

  test("a consent that was already cancelled opens nothing", async () => {
    const run = consentOptions(undefined, undefined, { signal: AbortSignal.abort() })

    const error = await failureOf(runConsent(run.options))

    expect(error.message).toBe("The call was cancelled.")
    expect(run.opened).toEqual([])
    expect(run.notices).toEqual([])
  })
})

describe("a browser that cannot be opened", () => {
  test("is only said, and the person can still answer on the address given", async () => {
    const run = consentOptions(undefined, async () => {
      throw new Error("no opener")
    })

    const pending = runConsent(run.options)
    await until(() => run.notices.length === 2)
    const url = run.notices[0]!.split("\n")[1]!
    const { redirectUri, state } = targetOf(url)
    await visit(redirectUri, { state, code: AUTH_CODE })
    const result = await pending

    expect(run.notices[1]).toContain("could not be opened")
    expect(result.refresh_token).not.toBe("")
  })
})
