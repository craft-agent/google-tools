import { lstat } from "node:fs/promises"
import { isMissingPath } from "../core/google/missing-path"

/** Whether anything, a link included, stands at `path`. */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (isMissingPath(error)) return false
    throw error
  }
}
