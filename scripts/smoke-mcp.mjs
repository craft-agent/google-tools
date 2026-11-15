import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { PLUGIN_NAME } from "./package-name.mjs"
import { ACCOUNT_READ, SHEETS_READ } from "./smoke-shared.mjs"

const SERVER = fileURLToPath(new URL("../dist/mcp.js", import.meta.url))
const EXIT_USAGE = 2
const UNKNOWN_TOOL = "unknown_nonexistent_read"

const stateDir = mkdtempSync(join(tmpdir(), "mcp-smoke-"))

async function listTools() {
  const client = new Client({ name: "smoke", version: "0.0.0" })
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER, "--state-dir", stateDir] }))
  try {
    const serverName = client.getServerVersion()?.name
    if (serverName !== PLUGIN_NAME)
      throw new Error(`Expected the server to be named ${PLUGIN_NAME}, got ${serverName}.`)
    const { tools } = await client.listTools()
    console.log(`The MCP server ${serverName} lists ${tools.length} tools.`)

    const accountRead = tools.find((tool) => tool.name === ACCOUNT_READ)
    if (accountRead?.annotations?.readOnlyHint !== true) {
      throw new Error(`Expected ${ACCOUNT_READ} to be listed with readOnlyHint, got ${JSON.stringify(accountRead)}`)
    }
    const listed = await client.callTool({ name: ACCOUNT_READ, arguments: { method: "list" } })
    if (listed.isError || JSON.stringify(listed.structuredContent) !== JSON.stringify({ accounts: [] })) {
      throw new Error(`Expected no accounts from ${ACCOUNT_READ} list, got ${JSON.stringify(listed)}`)
    }
    if (readdirSync(stateDir).length !== 0) throw new Error("Listing the accounts must not create state.")
    console.log(`The MCP server lists ${ACCOUNT_READ}, which returns no accounts from an empty state directory.`)

    const sheetsRead = tools.find((tool) => tool.name === SHEETS_READ)
    if (sheetsRead?.annotations?.readOnlyHint !== true) {
      throw new Error(`Expected ${SHEETS_READ} to be listed with readOnlyHint, got ${JSON.stringify(sheetsRead)}`)
    }
    console.log(`The MCP server lists ${SHEETS_READ} with readOnlyHint.`)

    const result = await client.callTool({ name: UNKNOWN_TOOL })
    const [block] = result.content
    const code = block?.type === "text" ? JSON.parse(block.text).error?.code : undefined
    if (result.isError !== true || code !== "invalid_argument") {
      throw new Error(`Expected an invalid_argument error result for ${UNKNOWN_TOOL}, got ${JSON.stringify(result)}`)
    }
    console.log(`Calling ${UNKNOWN_TOOL} gives an invalid_argument error result.`)
  } finally {
    await client.close()
  }
}

function rejectsBadSettings() {
  const run = spawnSync(process.execPath, [SERVER, "--toolsets", "bogus"], { encoding: "utf8", stdio: "pipe" })
  if (run.status !== EXIT_USAGE) {
    throw new Error(`Expected exit ${EXIT_USAGE} for --toolsets bogus, got ${run.status}: ${run.stderr}`)
  }
  if (run.stdout !== "") throw new Error(`Expected nothing on stdout for --toolsets bogus, got: ${run.stdout}`)
  console.log(`--toolsets bogus exits ${EXIT_USAGE}: ${run.stderr.trim()}`)
}

try {
  await listTools()
  rejectsBadSettings()
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  rmSync(stateDir, { recursive: true, force: true })
}
