import { z } from "zod"
import { cut } from "../describe"
import { ToolError } from "../errors"
import type { GoogleClient } from "../google/client"
import { splitRange } from "./a1"
import { MAX_RANGE_LENGTH } from "./schemas"
import { fetchValueRanges } from "./values"

/** The most cells one call guards. */
export const MAX_EXPECT = 200

/** The most characters of a displayed value that a refusal repeats. */
const MAX_FOUND_LENGTH = 200

/** How many differing cells the refusal's message lists; `details` lists them all. */
const MAX_LISTED_DIFFERENCES = 5

/** One cell of A1 notation: up to three letters, then a row number from 1, no `$`. */
const SINGLE_CELL_PATTERN = /^[A-Za-z]{1,3}[1-9][0-9]*$/

/** Whether the range is one cell, with a tab or without one. */
function isOneCell(range: string): boolean {
  const parts = splitRange(range)
  return parts !== undefined && SINGLE_CELL_PATTERN.test(parts.cells)
}

const guardSchema = z.strictObject({
  range: z
    .string()
    .min(1)
    .max(MAX_RANGE_LENGTH)
    .refine(isOneCell, { error: "must be one cell, such as `Plan!B12` or `B12`." })
    .describe("One cell, in A1 notation (`Plan!B12`, `'My tab'!B12`, or `B12` for the first tab)."),
  value: z
    .union([z.string(), z.number(), z.boolean()])
    .describe("What the cell must show now, as displayed (trimmed); `true` and `false` mean TRUE and FALSE."),
})

/** The `expect` argument of the tools that overwrite cells. */
export const expectArg = z
  .array(guardSchema)
  .min(1)
  .max(MAX_EXPECT)
  .optional()
  .describe(
    `1 to ${MAX_EXPECT} cells the call expects to show certain values right now, as displayed. Read the rows first (google_sheets_read), then name a header cell and an id cell of the rows being changed: if any cell differs (the rows have moved), nothing is written and the call fails as \`stale\` with the cells that differ.`,
  )

export type Guard = z.output<typeof guardSchema>

/** A guarded value as the sheet would show it, trimmed: `TRUE` or `FALSE` for a boolean. */
export function plain(value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE"
  return String(value).trim()
}

/** The text of the first cell of a range's rows as displayed, trimmed; none is `""`. */
function displayed(rows: readonly (readonly unknown[])[]): string {
  const cell = rows[0]?.[0]
  return typeof cell === "string" || typeof cell === "number" || typeof cell === "boolean" ? plain(cell) : ""
}

/**
 * Reads the guarded cells as the sheet shows them (one call) and refuses as
 * `stale`, with nothing written, when any differs from what the call expected;
 * `details.differs` lists every difference and the message the first few.
 * Google answering for another number of ranges than asked is `upstream_error`.
 */
export async function checkExpect(client: GoogleClient, id: string, guards: readonly Guard[]): Promise<void> {
  const fetched = await fetchValueRanges(
    client,
    id,
    guards.map((guard) => guard.range),
    "formatted",
  )
  if (fetched.length !== guards.length) {
    throw new ToolError(
      "upstream_error",
      "Google returned an unexpected number of ranges when the expected cells were checked; nothing was written.",
    )
  }
  const differs = guards.flatMap((guard, position) => {
    const expected = plain(guard.value)
    const found = displayed(fetched[position]!.values)
    return found === expected ? [] : [{ range: guard.range, expected, found: cut(found, MAX_FOUND_LENGTH) }]
  })
  if (differs.length === 0) return

  const listed = differs
    .slice(0, MAX_LISTED_DIFFERENCES)
    .map(
      ({ range, expected, found }) =>
        `${range}: expected ${JSON.stringify(cut(expected, MAX_FOUND_LENGTH))}, found ${JSON.stringify(found)}`,
    )
    .join("; ")
  const more = differs.length > MAX_LISTED_DIFFERENCES ? `; +${differs.length - MAX_LISTED_DIFFERENCES} more` : ""
  throw new ToolError(
    "stale",
    `Nothing was written: the cells the call expected differ (the rows may have moved; read them again): ${listed}${more}`,
    { details: { differs } },
  )
}
