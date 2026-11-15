import { z } from "zod"
import type { PlannedOperation } from "./operations"

const count = z.number().optional()

/** The replies of Google's batch that carry a count, each as it answers the request that makes it; the others are empty. */
const replyShape = z.object({
  findReplace: z
    .object({
      occurrencesChanged: count,
      valuesChanged: count,
      formulasChanged: count,
      rowsChanged: count,
      sheetsChanged: count,
    })
    .optional(),
  deleteDuplicates: z.object({ duplicatesRemovedCount: count }).optional(),
  trimWhitespace: z.object({ cellsChangedCount: count }).optional(),
})

type Reply = z.output<typeof replyShape>

/** What one operation of the call did, in the order of the operations: its `op`, and the counts Google reports for the ones that report any. */
export const transformResultSchema = z.object({
  op: z.string(),
  occurrences_changed: z
    .number()
    .int()
    .optional()
    .describe("find_replace: how many occurrences of the text were replaced."),
  values_changed: z
    .number()
    .int()
    .optional()
    .describe("find_replace: how many cells with that text as a value changed."),
  formulas_changed: z
    .number()
    .int()
    .optional()
    .describe("find_replace: how many cells with that text in a formula changed."),
  rows_changed: z.number().int().optional().describe("find_replace: how many rows have a changed cell."),
  tabs_changed: z.number().int().optional().describe("find_replace: how many tabs have a changed cell."),
  duplicates_removed: z.number().int().optional().describe("dedupe: how many duplicate rows were deleted."),
  cells_changed: z.number().int().optional().describe("trim: how many cells had spaces removed."),
})

export type TransformResult = z.output<typeof transformResultSchema>

/** The counts an operation reports, by the operation, from the replies to the requests it made. */
const COUNTS: Record<string, (replies: readonly Reply[]) => Omit<TransformResult, "op">> = {
  find_replace: ([reply]) => ({
    occurrences_changed: reply?.findReplace?.occurrencesChanged ?? 0,
    values_changed: reply?.findReplace?.valuesChanged ?? 0,
    formulas_changed: reply?.findReplace?.formulasChanged ?? 0,
    rows_changed: reply?.findReplace?.rowsChanged ?? 0,
    tabs_changed: reply?.findReplace?.sheetsChanged ?? 0,
  }),
  dedupe: ([reply]) => ({ duplicates_removed: reply?.deleteDuplicates?.duplicatesRemovedCount ?? 0 }),
  trim: (replies) => ({
    cells_changed: replies.reduce((total, reply) => total + (reply.trimWhitespace?.cellsChangedCount ?? 0), 0),
  }),
}

/**
 * The result of each planned operation, in order. Google answers a batch with
 * one reply per request, so an operation's replies are the ones its requests
 * stand at; a reply that is not in the shape expected counts as empty, since
 * the batch has landed by then.
 */
export function resultsOf(steps: readonly PlannedOperation[], replies: readonly unknown[]): TransformResult[] {
  let offset = 0
  return steps.map(({ name, requests }) => {
    const own = replies.slice(offset, offset + requests.length).map((reply) => replyShape.safeParse(reply).data ?? {})
    offset += requests.length
    return { op: name, ...COUNTS[name]?.(own) }
  })
}
