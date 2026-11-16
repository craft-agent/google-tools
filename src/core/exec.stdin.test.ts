import { describe, expect, test } from "bun:test"
import { exec } from "./exec"

const ENV = { PATH: process.env.PATH ?? "" }

const CHUNK_BYTES = 64 * 1024

/** A child that counts the bytes it is given until its stdin ends, then writes the count. */
const COUNT_BYTES = 'let n=0;process.stdin.on("data",c=>n+=c.length).on("end",()=>process.stdout.write(String(n)))'

/** An async source of `count` chunks that tallies how many it produced and whether it was closed. */
function source(count: number) {
  const state = { produced: 0, closed: false }
  async function* chunks(): AsyncGenerator<Uint8Array> {
    try {
      for (let index = 0; index < count; index++) {
        state.produced++
        yield new Uint8Array(CHUNK_BYTES).fill(index % 256)
      }
    } finally {
      state.closed = true
    }
  }
  return { state, chunks: chunks() }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("exec with an iterable for stdin", () => {
  test("writes every chunk, in order, and closes stdin", async () => {
    const { state, chunks } = source(50)
    const result = await exec(["node", "-e", COUNT_BYTES], { env: ENV, stdin: chunks })
    expect(result).toEqual({ code: 0, stdout: String(50 * CHUNK_BYTES), stderr: "" })
    expect(state.closed).toBe(true)
  })

  test("hands the bytes over unchanged", async () => {
    async function* parts() {
      yield new TextEncoder().encode("hel")
      yield new TextEncoder().encode("lo")
    }
    const result = await exec(["node", "-e", "process.stdin.pipe(process.stdout)"], { env: ENV, stdin: parts() })
    expect(result.stdout).toBe("hello")
  })

  test("takes chunks only as fast as the child reads them", async () => {
    const { state, chunks } = source(1000)
    const slow = `setTimeout(() => {${COUNT_BYTES}}, 400)`
    const pending = exec(["node", "-e", slow], { env: ENV, stdin: chunks })
    await wait(200)
    const producedWhileWaiting = state.produced
    const result = await pending
    expect(producedWhileWaiting).toBeLessThan(30)
    expect(result.stdout).toBe(String(1000 * CHUNK_BYTES))
  })

  test("a child that exits without reading is its own failure: no crash, its code and its message", async () => {
    const { state, chunks } = source(1000)
    const result = await exec(["node", "-e", 'process.stderr.write("no input wanted");process.exit(3)'], {
      env: ENV,
      stdin: chunks,
    })
    expect(result.code).toBe(3)
    expect(result.stderr).toBe("no input wanted")
    expect(state.produced).toBeLessThan(1000)
    expect(state.closed).toBe(true)
  })

  test("an abort stops writing, closes the source and rejects with an AbortError", async () => {
    const { state, chunks } = source(100_000)
    const controller = new AbortController()
    const pending = exec(["node", "-e", "setTimeout(() => {}, 10000)"], {
      env: ENV,
      stdin: chunks,
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 100)
    const error = await pending.catch((e: unknown) => e)
    expect((error as Error).name).toBe("AbortError")
    const deadline = Date.now() + 2000
    while (!state.closed && Date.now() < deadline) await wait(20)
    expect(state.closed).toBe(true)
    expect(state.produced).toBeLessThan(100_000)
  })

  test("a source that throws stops the child and rejects with its error", async () => {
    async function* failing(): AsyncGenerator<Uint8Array> {
      yield new Uint8Array(10)
      throw new Error("the source failed")
    }
    const started = Date.now()
    const error = await exec(["node", "-e", "setTimeout(() => {}, 10000)"], { env: ENV, stdin: failing() }).catch(
      (e: unknown) => e,
    )
    expect((error as Error).message).toBe("the source failed")
    expect(Date.now() - started).toBeLessThan(5000)
  })

  test("an empty source gives the child an empty stdin that ends", async () => {
    async function* nothing(): AsyncGenerator<Uint8Array> {}
    const result = await exec(["node", "-e", COUNT_BYTES], { env: ENV, stdin: nothing() })
    expect(result.stdout).toBe("0")
  })
})
