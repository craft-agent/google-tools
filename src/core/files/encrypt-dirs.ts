import { realpath } from "node:fs/promises"
import type { ToolContext } from "../tool"
import { isInside } from "./download"

/** The package setting that names the directories whose files are uploaded only encrypted. */
export const ENCRYPT_DIRS_OPTION = "encrypt_dirs"

/** The directories the call's `encrypt_dirs` setting names; none when a person has named none. */
export function encryptDirsOf(ctx: Pick<ToolContext, "options">): readonly string[] {
  const dirs = ctx.options?.[ENCRYPT_DIRS_OPTION]
  return typeof dirs === "object" ? dirs : []
}

/**
 * A path with its case and Unicode form folded away, so two spellings of one
 * file on a filesystem that ignores both give the same key. Upper-casing
 * first folds what lower-casing alone keeps apart (`ß` and `ss`).
 */
function foldedPath(path: string): string {
  return path.normalize("NFC").toUpperCase().toLowerCase().normalize("NFC")
}

/**
 * Whether `real`, the real path of a file, lies inside a directory
 * `encrypt_dirs` names, each judged by its real path. Paths are compared with
 * case and Unicode normalization ignored, since a case-insensitive filesystem
 * would otherwise let a differently spelled path escape: a path may be
 * taken for inside when it is not, never the other way. A directory that does
 * not exist or cannot be resolved is judged by the path as written: on a
 * filesystem that tells Unicode forms apart, a directory named in one form
 * does not exist in the other, and the folded comparison still catches it.
 */
export async function isUnderEncryptDirs(real: string, dirs: readonly string[]): Promise<boolean> {
  const file = foldedPath(real)
  for (const dir of dirs) {
    const root = await realpath(dir).catch(() => dir)
    if (isInside(file, foldedPath(root))) return true
  }
  return false
}
