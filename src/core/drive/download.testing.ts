import { readdir } from "node:fs/promises"
import { join } from "node:path"
import type { FakeHandler } from "../google/fake-google.testing"
import { FILE_ID, exportUrl, fileUrl, fixture, type Fixture } from "./read.testing"

/** Fixtures the Drive download tests share. */

/** The time the fixtures' clock stands at, as a saved file's name carries it. */
export const STAMP = "20260601-120000"

/** The arguments of a plain `download` of the file `FILE_ID`. */
export const download = (more: Record<string, unknown> = {}) => ({ method: "download", file_id: FILE_ID, ...more })

/** `files.get` answering `meta` and, with `alt=media`, `bytes` as `type`. */
export const serving = (
  meta: Record<string, unknown>,
  bytes: Uint8Array<ArrayBuffer>,
  type = "application/pdf",
): FakeHandler => ({
  method: "GET",
  url: fileUrl(FILE_ID),
  reply: (request) =>
    request.url.searchParams.get("alt") === "media" ? { bytes, headers: { "content-type": type } } : { json: meta },
})

/** The metadata handler alone, for a file that must not be fetched. */
export const describing = (meta: Record<string, unknown>): FakeHandler => ({
  method: "GET",
  url: fileUrl(FILE_ID),
  reply: { json: meta },
})

/** A fixture whose file is `meta` and whose export is `bytes` as `type`. */
export const exporting = (meta: Record<string, unknown>, bytes: Uint8Array<ArrayBuffer>, type: string) =>
  fixture([
    describing(meta),
    { method: "GET", url: exportUrl(FILE_ID), reply: { bytes, headers: { "content-type": type } } },
  ])

/** The names in the Drive download directory. */
export async function saved(h: Fixture): Promise<string[]> {
  return (await readdir(join(h.downloadDir, "drive")).catch(() => [])).sort()
}

export const BYTES = new TextEncoder().encode("%PDF-1.4 made up") as Uint8Array<ArrayBuffer>
