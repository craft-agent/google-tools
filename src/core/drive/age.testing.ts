import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { emptyPath, writeRenderer } from "../sheets/snapshot-renderers.testing"

/** A fake `age` for the upload tests: a shell script that writes a known ciphertext and logs what it saw, on a `PATH` of its own. */

/** Made-up X25519 recipients: `age1` and 58 characters of the bech32 alphabet. */
export const RECIPIENT = `age1${"q".repeat(58)}`
export const OTHER_RECIPIENT = `age1${"p".repeat(58)}`

/** What the fake age's output starts with; the rest is the plaintext it was given. */
export const FAKE_CIPHERTEXT_PREFIX = "AGE-FAKE:"

/** The system directories the fake's helpers (`cat`, `ls`, `cut`) are found in. */
const SYSTEM_PATH = "/bin:/usr/bin"

const MODES_LOG = "modes.log"
const OUTPUTS_LOG = "outputs.log"

/**
 * The body of a fake age: `--version` answers; otherwise it logs the mode of
 * its output directory and the output's path, then writes the prefix and its
 * standard input to the file `-o` names.
 */
export const FAKE_AGE_BODY = [
  `if [ "$1" = "--version" ]; then echo "v1.2.0"; exit 0; fi`,
  `while [ $# -gt 0 ]; do if [ "$1" = "-o" ]; then out=$2; fi; shift; done`,
  `ls -ld "\${out%/*}" | cut -c1-10 >> "\${0%/*}/${MODES_LOG}"`,
  `echo "$out" >> "\${0%/*}/${OUTPUTS_LOG}"`,
  `printf '${FAKE_CIPHERTEXT_PREFIX}' > "$out"`,
  `cat >> "$out"`,
].join("\n")

/** A directory with the fake `age` (running `body`) in it, and the `PATH` that finds it first; `bin` also has its logs. */
export async function agePath(made: string[], body = FAKE_AGE_BODY): Promise<{ bin: string; path: string }> {
  const bin = await emptyPath(made)
  await writeRenderer(bin, "age", body)
  return { bin, path: `${bin}:${SYSTEM_PATH}` }
}

async function lines(path: string): Promise<string[]> {
  return (await readFile(path, "utf8").catch(() => "")).split("\n").filter((line) => line !== "")
}

/** The modes of the directories the fake wrote its output in, one per run (`drwx------`). */
export const outputDirModes = (bin: string) => lines(join(bin, MODES_LOG))

/** The files the fake wrote its output to, one per run. */
export const outputFiles = (bin: string) => lines(join(bin, OUTPUTS_LOG))
