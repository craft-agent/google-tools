import { afterEach, describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { FAKE_AGE_BODY, FAKE_CIPHERTEXT_PREFIX, OTHER_RECIPIENT, RECIPIENT, agePath } from "../drive/age.testing"
import { ToolError } from "../errors"
import { emptyPath, failingBody, removeAll, renderCalls } from "../sheets/snapshot-renderers.testing"
import { AGE_RECIPIENTS_OPTION, ageRecipientsOf, checkedRecipients, encryptWithAge, requireAge } from "./age"

const made: string[] = []

afterEach(() => removeAll(made))

const outputIn = async () => join(await emptyPath(made), "out.age")

async function* pieces(...texts: string[]): AsyncGenerator<Uint8Array> {
  for (const text of texts) yield new TextEncoder().encode(text)
}

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => error as ToolError,
  )

describe("ageRecipientsOf and checkedRecipients", () => {
  test("read the setting's list, none when it is not set", () => {
    expect(ageRecipientsOf({ options: { [AGE_RECIPIENTS_OPTION]: [RECIPIENT] } })).toEqual([RECIPIENT])
    expect(ageRecipientsOf({})).toEqual([])
  })

  test("sort the recipients and drop repeats", () => {
    expect(checkedRecipients([RECIPIENT, OTHER_RECIPIENT, RECIPIENT])).toEqual([OTHER_RECIPIENT, RECIPIENT])
  })

  test("no recipient is forbidden: a person names them", () => {
    const error = (() => {
      try {
        checkedRecipients([])
      } catch (e) {
        return e as ToolError
      }
    })()
    expect([error?.code, error?.message]).toEqual(["forbidden", expect.stringContaining("age_recipients")])
  })

  test("an entry that is no X25519 age key is invalid_argument naming its place and never itself", () => {
    const secret = "AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ"
    const bad = [
      "age1short",
      secret,
      RECIPIENT.toUpperCase(),
      `${RECIPIENT}x`,
      `age1${"b".repeat(58)}`,
      "ssh-ed25519 AAAA",
      "age1plugin",
    ]
    for (const entry of bad) {
      let error: ToolError | undefined
      try {
        checkedRecipients([RECIPIENT, entry])
      } catch (e) {
        error = e as ToolError
      }
      expect([entry, error?.code]).toEqual([entry, "invalid_argument"])
      expect(error?.message).toContain("Entry 2 of 2 in the age_recipients setting")
      expect(error?.message).not.toContain(entry)
    }
  })
})

describe("requireAge", () => {
  test("passes when age answers --version with 0", async () => {
    const { bin, path } = await agePath(made)
    await requireAge({ PATH: path })
    expect(await renderCalls(bin)).toEqual(["age --version"])
  })

  test("fails as upstream_error saying age must be installed when it is not on the PATH", async () => {
    const error = await failure(requireAge({ PATH: await emptyPath(made) }))
    expect(error?.code).toBe("upstream_error")
    expect(error?.message).toContain("age is not installed")
    expect(error?.message).toContain("encrypt_dirs")
  })

  test("fails when age exits with an error, with its message", async () => {
    const { path } = await agePath(made, failingBody("broken build"))
    const error = await failure(requireAge({ PATH: path }))
    expect([error?.code, error?.message]).toEqual(["upstream_error", "age does not run: broken build"])
  })
})

describe("encryptWithAge", () => {
  test("runs age with each recipient and the output, and gives it the input on stdin", async () => {
    const { bin, path } = await agePath(made)
    const output = await outputIn()
    await encryptWithAge({
      recipients: [OTHER_RECIPIENT, RECIPIENT],
      output,
      input: pieces("sec", "ret"),
      env: { PATH: path },
    })

    expect(await readFile(output, "utf8")).toBe(`${FAKE_CIPHERTEXT_PREFIX}secret`)
    expect(await renderCalls(bin)).toEqual([`age -r ${OTHER_RECIPIENT} -r ${RECIPIENT} -o ${output}`])
  })

  test("gets PATH and nothing else of the environment", async () => {
    const body = `${FAKE_AGE_BODY}\necho "[$HOME][$SECRET]" > "\${0%/*}/env.log"`
    const { bin, path } = await agePath(made, body)
    await encryptWithAge({
      recipients: [RECIPIENT],
      output: await outputIn(),
      input: pieces("x"),
      env: { PATH: path, HOME: "/home/someone", SECRET: "hunter2" },
    })
    expect(await readFile(join(bin, "env.log"), "utf8")).toBe("[][]\n")
  })

  test("age missing is upstream_error", async () => {
    const error = await failure(
      encryptWithAge({
        recipients: [RECIPIENT],
        output: await outputIn(),
        input: pieces("x"),
        env: { PATH: await emptyPath(made) },
      }),
    )
    expect([error?.code, error?.message]).toEqual(["upstream_error", expect.stringContaining("age is not installed")])
  })

  test("a failed age is upstream_error with its standard error masked and clipped to 200 characters", async () => {
    const message = `ya29.fake-access-token-0000000000000001 ${"e".repeat(400)}`
    const body = `if [ "$1" = "--version" ]; then exit 0; fi\necho "${message}" >&2\nexit 3`
    const { path } = await agePath(made, body)
    const error = await failure(
      encryptWithAge({ recipients: [RECIPIENT], output: await outputIn(), input: pieces("x"), env: { PATH: path } }),
    )
    expect(error?.code).toBe("upstream_error")
    expect(error?.message).toBe(`age failed: [masked] ${"e".repeat(200 - "[masked] ".length)}`)
  })

  test("an error of the input is the call's error, not age's", async () => {
    const { path } = await agePath(made)
    async function* failing(): AsyncGenerator<Uint8Array> {
      yield new Uint8Array(3)
      throw new ToolError("stale", "the plaintext changed")
    }
    const error = await failure(
      encryptWithAge({ recipients: [RECIPIENT], output: await outputIn(), input: failing(), env: { PATH: path } }),
    )
    expect([error?.code, error?.message]).toEqual(["stale", "the plaintext changed"])
  })

  test("an aborted call rejects with an AbortError", async () => {
    const { path } = await agePath(made)
    const error = await failure(
      encryptWithAge({
        recipients: [RECIPIENT],
        output: await outputIn(),
        input: pieces("x"),
        env: { PATH: path },
        signal: AbortSignal.abort(),
      }),
    )
    expect(error?.name).toBe("AbortError")
  })
})
