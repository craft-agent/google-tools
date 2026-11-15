import { z } from "zod"
import { cut, isRecord } from "../describe"
import { ToolError } from "../errors"
import type { GoogleClient } from "../google/client"
import { splitRange } from "./a1"
import { metadataDifferences, type Difference } from "./expect-metadata"
import { MAX_METADATA_KEY_LENGTH, MAX_METADATA_VALUE_LENGTH, MAX_RANGE_LENGTH } from "./schemas"
import type { OpenSpreadsheet } from "./tabs"
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

/** The one cell a guard looks at. */
const cellArg = z
  .string()
  .min(1)
  .max(MAX_RANGE_LENGTH)
  .refine(isOneCell, { error: "must be one cell, such as `Plan!B12` or `B12`." })
  .describe("One cell, in A1 notation (`Plan!B12`, `'My tab'!B12`, or `B12` for the first tab).")

const valueGuardSchema = z.strictObject({
  range: cellArg,
  value: z
    .union([z.string(), z.number(), z.boolean()])
    .describe("What the cell must show now, as displayed (trimmed); `true` and `false` mean TRUE and FALSE."),
})

const metadataGuardSchema = z.strictObject({
  range: cellArg.describe("A cell of the row (or column) that must carry the mark, in A1 notation."),
  metadata: z
    .strictObject({
      key: z.string().min(1).max(MAX_METADATA_KEY_LENGTH).describe("The mark's key."),
      value: z
        .string()
        .min(1)
        .max(MAX_METADATA_VALUE_LENGTH)
        .optional()
        .describe("The mark's value; left out, any value."),
    })
    .describe("The developer metadata the row (or column) of `range` must carry."),
  along: z
    .enum(["rows", "columns"])
    .optional()
    .describe("`rows` (the default): the row of `range` must carry it; `columns`: its column must."),
})

/** Why a guard was refused: the problems of the form the guard was written in, `metadata` marking the second. */
const guardError: z.core.$ZodErrorMap = (issue) => {
  if (issue.code !== "invalid_union") return undefined
  const form = isRecord(issue.input) && "metadata" in issue.input ? 1 : 0
  const problems = (issue.errors[form] ?? []).map(
    (problem) => `${problem.path.length > 0 ? `${problem.path.join(".")}: ` : ""}${problem.message}`,
  )
  return problems.length > 0 ? problems.join("; ") : undefined
}

/** The forms of one guard, for the tools' descriptions. */
export const EXPECT_FORMS = `\`{ range, value }\` (the cell shows that, as displayed) or \`{ range, metadata: { key, value? }, along? }\` (the row, or with \`along: "columns"\` the column, of the one cell \`range\` carries that developer metadata, the mark google_sheets_read's \`metadata\` method lists)`

/** The `expect` argument of the tools that overwrite cells. */
export const expectArg = z
  .array(z.union([valueGuardSchema, metadataGuardSchema], { error: guardError }))
  .min(1)
  .max(MAX_EXPECT)
  .optional()
  .describe(
    `1 to ${MAX_EXPECT} guards the call makes right now, each ${EXPECT_FORMS}. Read the rows first (google_sheets_read), then name a header cell and an id cell of the rows being changed, or the mark they carry: if any guard fails (the rows have moved), nothing is written and the call fails as \`stale\` with the guards that differ. A \`metadata\` guard finds a row by its mark, so it holds when rows were sorted or inserted above, as long as the mark moved with its row (Google moves a row's metadata with the row); a \`value\` guard holds only for the cell where it stands.`,
  )

type ValueGuard = z.output<typeof valueGuardSchema>

export type MetadataGuard = z.output<typeof metadataGuardSchema>

export type Guard = ValueGuard | MetadataGuard

/** Whether the guard looks for developer metadata rather than a value. */
function isMetadataGuard(guard: Guard): guard is MetadataGuard {
  return "metadata" in guard
}

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
 * Reads the guarded cells as the sheet shows them (one call; none for no value
 * guard), and gives for each in order what differs from what the call expected,
 * or `undefined`. Google answering for another number of ranges than asked is
 * `upstream_error`.
 */
async function valueDifferences(
  client: GoogleClient,
  id: string,
  guards: readonly ValueGuard[],
): Promise<(Difference | undefined)[]> {
  if (guards.length === 0) return []
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
  return guards.map((guard, position) => {
    const expected = plain(guard.value)
    const found = displayed(fetched[position]!.values)
    return found === expected ? undefined : { range: guard.range, expected, found: cut(found, MAX_FOUND_LENGTH) }
  })
}

/**
 * Checks the guards as the spreadsheet is now and refuses as `stale`, with
 * nothing written, when any differs from what the call expected: first one read
 * of the guarded cells' values, then one search of the developer metadata the
 * metadata guards look for. `details.differs` lists every difference, in the
 * order of the guards, and the message the first few.
 */
export async function checkExpect(
  { client, id, tabs }: Pick<OpenSpreadsheet, "client" | "id" | "tabs">,
  guards: readonly Guard[],
): Promise<void> {
  const byValue = await valueDifferences(
    client,
    id,
    guards.filter((guard): guard is ValueGuard => !isMetadataGuard(guard)),
  )
  const byMark = await metadataDifferences(client, id, tabs, guards.filter(isMetadataGuard))
  const nextByValue = byValue.values()
  const nextByMark = byMark.values()
  const differs = guards.flatMap((guard) => {
    const difference = (isMetadataGuard(guard) ? nextByMark : nextByValue).next().value
    return difference === undefined ? [] : [difference]
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
