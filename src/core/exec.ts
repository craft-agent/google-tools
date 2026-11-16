import { spawn } from "node:child_process"
import type { Writable } from "node:stream"

/** How long a child that was sent SIGTERM may keep running before it is sent SIGKILL. */
const KILL_GRACE_MS = 2000
/** How long output may still arrive after the child exited, for a grandchild that keeps the pipes open. */
const DRAIN_MS = 100

export type ExecOptions = {
  cwd?: string
  /** The child's whole environment; nothing is merged in from this process. */
  env: Record<string, string>
  /**
   * What is written to the child's stdin, which is then closed: text, or bytes
   * pulled from an iterable as the child takes them in, so a large input is
   * never held whole. An iterable that throws stops the child and rejects with
   * its error. Without it stdin is not connected.
   */
  stdin?: string | AsyncIterable<Uint8Array>
  /** Stops the child (SIGTERM, then SIGKILL) and rejects with an `AbortError` when it aborts. */
  signal?: AbortSignal
  /** Stops the child (SIGTERM, then SIGKILL) after this many milliseconds. */
  timeoutMs?: number
}

export type ExecResult = {
  /** The exit code, or -1 when the child ended on a signal. */
  code: number
  stdout: string
  stderr: string
  /** The signal that ended the child, when one did. */
  signal?: string
  /** Set when `timeoutMs` elapsed and the child was stopped for it. */
  timedOut?: true
}

/** The `AbortError` that stands for an aborted signal, whatever reason the signal carries. */
export function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  if (reason instanceof Error && reason.name === "AbortError") return reason
  const error = new Error("The operation was aborted", { cause: reason })
  error.name = "AbortError"
  return error
}

/** Resolves when `sink` can take more, or has closed (a child that exited), which it never recovers from. */
function drained(sink: Writable): Promise<void> {
  return new Promise((resolve) => {
    if (sink.destroyed) return resolve()
    const done = () => {
      sink.off("drain", done)
      sink.off("close", done)
      resolve()
    }
    sink.once("drain", done)
    sink.once("close", done)
  })
}

/**
 * Writes what `source` yields to `sink`, one chunk at a time and waiting for
 * the sink to drain between them, then ends it. It stops, closing `source`,
 * as soon as `stopped()` says so or the sink is gone (the child exited without
 * reading it all); the sink's own `EPIPE` is the child's business, not an error here.
 * Rejects only with an error of `source`.
 */
async function pipeTo(source: AsyncIterable<Uint8Array>, sink: Writable, stopped: () => boolean): Promise<void> {
  for await (const chunk of source) {
    if (stopped() || sink.destroyed) return
    if (!sink.write(chunk)) await drained(sink)
  }
  if (!stopped() && !sink.destroyed) sink.end()
}

/**
 * Runs a program without a shell and collects its output as UTF-8. A program
 * that cannot be started rejects with the spawn error, whose `code` is
 * `"ENOENT"` when it is not on the `PATH` of `options.env`.
 *
 * The call settles as soon as the child exits, not when its pipes close: a
 * grandchild that inherited them gets `DRAIN_MS` to finish its output and is
 * then left alone.
 */
export function exec(argv: string[], options: ExecOptions): Promise<ExecResult> {
  const { signal } = options
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal))
      return
    }
    const [program, ...args] = argv
    if (!program) {
      reject(new Error("exec needs a program to run"))
      return
    }

    const child = spawn(program, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk))
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk))
    // A child that exits without reading its stdin must not crash this process with EPIPE.
    child.stdin?.on("error", () => {})
    if (typeof options.stdin === "string") child.stdin?.end(options.stdin)

    let settled = false
    let timedOut = false
    let exitedWith: { code: number | null; killedBy: NodeJS.Signals | null } | undefined
    let killTimer: ReturnType<typeof setTimeout> | undefined
    let drainTimer: ReturnType<typeof setTimeout> | undefined
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined

    const settle = (outcome: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutTimer)
      clearTimeout(drainTimer)
      signal?.removeEventListener("abort", onAbort)
      child.stdout?.destroy()
      child.stderr?.destroy()
      child.stdin?.destroy()
      outcome()
    }

    /** Sends SIGTERM and, if the child is still there after the grace period, SIGKILL; false when it had exited already. */
    const stop = (): boolean => {
      if (exitedWith || child.exitCode !== null || child.signalCode !== null) return false
      child.kill("SIGTERM")
      killTimer ??= setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS)
      return true
    }

    function onAbort() {
      stop()
      settle(() => reject(abortError(signal!)))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
    if (options.timeoutMs !== undefined) {
      timeoutTimer = setTimeout(() => {
        timedOut = stop()
      }, options.timeoutMs)
    }

    const finish = () =>
      settle(() => {
        const { code, killedBy } = exitedWith ?? { code: null, killedBy: null }
        resolve({
          code: code ?? -1,
          stdout,
          stderr,
          ...(killedBy ? { signal: killedBy } : {}),
          ...(timedOut ? { timedOut: true as const } : {}),
        })
      })

    child.on("error", (error) => {
      clearTimeout(killTimer)
      settle(() => reject(error))
    })
    child.on("exit", (code, killedBy) => {
      clearTimeout(killTimer)
      exitedWith = { code, killedBy }
      drainTimer = setTimeout(finish, DRAIN_MS)
    })
    child.on("close", (code, killedBy) => {
      exitedWith ??= { code, killedBy }
      finish()
    })

    if (options.stdin !== undefined && typeof options.stdin !== "string" && child.stdin) {
      pipeTo(options.stdin, child.stdin, () => settled).catch((error: unknown) => {
        stop()
        settle(() => reject(error))
      })
    }
  })
}
