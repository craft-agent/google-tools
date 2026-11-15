import { ToolError, exec } from "../core"

/** How long the platform's opener may run; it only hands the address to the browser. */
const OPEN_TIMEOUT_MS = 10_000

/** The variables the openers need to find a desktop session and a browser; nothing else is passed on. */
const OPENER_VARIABLES = [
  "PATH",
  "HOME",
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XDG_RUNTIME_DIR",
  "XDG_CURRENT_DESKTOP",
  "XDG_SESSION_TYPE",
  "DBUS_SESSION_BUS_ADDRESS",
  "DESKTOP_SESSION",
  "BROWSER",
  "SystemRoot",
  "ComSpec",
  "PATHEXT",
] as const

/** The command that opens `url` in the default browser of `platform`. */
export function openerCommand(url: string, platform: NodeJS.Platform): string[] {
  if (platform === "darwin") return ["open", url]
  // `cmd` would read an `&` of the URL as the end of its command.
  if (platform === "win32") return ["cmd", "/c", "start", "", url.replace(/&/g, "^&")]
  return ["xdg-open", url]
}

function openerEnv(env: Record<string, string | undefined>): Record<string, string> {
  const passed: Record<string, string> = {}
  for (const name of OPENER_VARIABLES) {
    const value = env[name]
    if (value !== undefined) passed[name] = value
  }
  return passed
}

/** Opens `url` in the person's default browser through the platform's opener; fails when the opener does. */
export async function openInBrowser(
  url: string,
  env: Record<string, string | undefined>,
  signal?: AbortSignal,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const result = await exec(openerCommand(url, platform), { env: openerEnv(env), signal, timeoutMs: OPEN_TIMEOUT_MS })
  if (result.code !== 0 && !result.timedOut) {
    throw new ToolError("internal_error", "The platform's opener could not open the browser.")
  }
}
