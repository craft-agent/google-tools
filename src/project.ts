import type { OptionSpec } from "./core"

/** What makes this package itself; a project made from the starter sets these once (the setup script does). */
export const PROJECT = {
  /** The plugin, MCP server and program name. */
  name: "google-tools",
  /** The command line the Hermes plugin calls. */
  cli: "google-tools-cli",
  /** Every tool ID starts with `<toolPrefix>_`. */
  toolPrefix: "google",
  /** Every setting's environment variable is `<envPrefix>_<SETTING>`. */
  envPrefix: "GOOGLE_TOOLS",
  /** The toolsets, in the order `all` lists them. */
  toolsets: ["account"] as readonly string[],
  /** The toolsets on when a setting names none. */
  defaultToolsets: ["account"] as readonly string[],
  /** The package's own settings, which the tools themselves read: each snake_case name and its type, with bounds when it needs them. */
  options: { state_dir: "path" } as Readonly<Record<string, OptionSpec>>,
  /** The environment variables the tools read besides the settings, which Codex forwards to the server after them. */
  toolVariables: ["XDG_STATE_HOME"] as readonly string[],
} as const
