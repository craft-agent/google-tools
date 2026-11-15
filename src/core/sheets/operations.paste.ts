import { z } from "zod"
import { ToolError } from "../errors"
import type { Keeps } from "./before"
import { defineOperation } from "./operations"
import { blockAt, onlyClosedArea, sizeOf, type ClosedArea } from "./operation-blocks"
import { areaLabel, resolveOn, rangeText, tabsOfAreas } from "./operation-ranges"
import { shownRange, type SheetTab } from "./tabs"

const PASTE_NAMES = ["all", "values", "format", "no_borders", "formulas", "input_rules", "conditional"] as const

type PasteName = (typeof PASTE_NAMES)[number]

const DEFAULT_PASTE: PasteName = "all"

/** Google's name for each thing a paste puts down. */
const PASTE_TYPES = {
  all: "PASTE_NORMAL",
  values: "PASTE_VALUES",
  format: "PASTE_FORMAT",
  no_borders: "PASTE_NO_BORDERS",
  formulas: "PASTE_FORMULA",
  input_rules: "PASTE_DATA_VALIDATION",
  conditional: "PASTE_CONDITIONAL_FORMATTING",
} as const satisfies Record<PasteName, string>

const pasteFields = {
  range: rangeText.describe("The closed block to take (`Plan!A1:C10`)."),
  to: rangeText.describe(
    "The top-left cell of the destination (`Archive!A1`); with no tab, the range's tab. The destination is the size of the range, and what is there is overwritten.",
  ),
  paste: z
    .enum(PASTE_NAMES)
    .optional()
    .describe(
      `What to put down: \`${DEFAULT_PASTE}\` (the default), \`values\`, \`format\`, \`no_borders\`, \`formulas\`, \`input_rules\` or \`conditional\`.`,
    ),
}

const copySchema = z.strictObject({
  op: z.literal("copy"),
  ...pasteFields,
  transpose: z.boolean().optional().describe("`true` swaps the rows and columns of the copy."),
})

const cutSchema = z.strictObject({ op: z.literal("cut"), ...pasteFields })

/** A copy or a cut: the block it takes, and the block of the same size (turned, for a transposed copy) it puts down. */
type Paste = { source: ClosedArea; destination: ClosedArea }

/** The blocks of a copy or cut, refusing a `to` that is not one cell. */
function pasteOf(
  op: { range: string; to: string; transpose?: boolean },
  tabs: readonly SheetTab[],
  name: string,
): Paste {
  const source = onlyClosedArea(op, tabs, name)
  const target = resolveOn(tabs, op.to, source.tab)
  const { startRowIndex, endRowIndex, startColumnIndex, endColumnIndex } = target.grid
  if (
    startRowIndex === undefined ||
    startColumnIndex === undefined ||
    endRowIndex !== startRowIndex + 1 ||
    endColumnIndex !== startColumnIndex + 1
  ) {
    throw new ToolError(
      "invalid_argument",
      `\`to\` is the top-left cell of the destination, such as \`Archive!A1\`, not ${JSON.stringify(shownRange(op.to))}.`,
    )
  }
  const { rows, columns } = sizeOf(source.grid)
  const size = op.transpose === true ? { rows: columns, columns: rows } : { rows, columns }
  return {
    source,
    destination: { tab: target.tab, grid: blockAt(target.tab.sheetId, startRowIndex, startColumnIndex, size) },
  }
}

/** The line of a copy or cut: what moves where, and what of it is put down when that is not everything. */
function pasteLine(
  name: string,
  { source, destination }: Paste,
  op: { paste?: PasteName; transpose?: boolean },
): string {
  const how = op.paste === undefined || op.paste === DEFAULT_PASTE ? "" : ` (paste ${op.paste})`
  return `${name} ${areaLabel(source)} to ${areaLabel(destination)}${op.transpose === true ? " transposed" : ""}${how}`
}

/** `copy`: copies a closed block to a destination of the same size, turned when transposed, overwriting it. */
export const copyOperation = defineOperation({
  schema: copySchema,
  requests(op, { tabs }) {
    const { source, destination } = pasteOf(op, tabs, "copy")
    return [
      {
        copyPaste: {
          source: source.grid,
          destination: destination.grid,
          pasteType: PASTE_TYPES[op.paste ?? DEFAULT_PASTE],
          pasteOrientation: op.transpose === true ? "TRANSPOSE" : "NORMAL",
        },
      },
    ]
  },
  tabs: (op, { tabs }) => [pasteOf(op, tabs, "copy").destination.tab],
  describe: (op, { tabs }) => pasteLine("copy", pasteOf(op, tabs, "copy"), op),
  loses: (op, { tabs }) => [{ area: pasteOf(op, tabs, "copy").destination }],
})

/** Whether the cell at the position in the destination, counted from its top-left cell, is a cell of the source, which a cut counts as lost with the source. */
function countedWithSource({ source, destination }: Paste): Keeps | undefined {
  if (source.tab.sheetId !== destination.tab.sheetId) return undefined
  return (row, column) => {
    const absoluteRow = destination.grid.startRowIndex + row
    const absoluteColumn = destination.grid.startColumnIndex + column
    return (
      absoluteRow >= source.grid.startRowIndex &&
      absoluteRow < source.grid.endRowIndex &&
      absoluteColumn >= source.grid.startColumnIndex &&
      absoluteColumn < source.grid.endColumnIndex
    )
  }
}

/** `cut`: moves a closed block's values to a destination of the same size, overwriting it and leaving the source empty. */
export const cutOperation = defineOperation({
  schema: cutSchema,
  requests(op, { tabs }) {
    const { source, destination } = pasteOf(op, tabs, "cut")
    return [
      {
        cutPaste: {
          source: source.grid,
          destination: {
            sheetId: destination.grid.sheetId,
            rowIndex: destination.grid.startRowIndex,
            columnIndex: destination.grid.startColumnIndex,
          },
          pasteType: PASTE_TYPES[op.paste ?? DEFAULT_PASTE],
        },
      },
    ]
  },
  tabs: (op, { tabs }) => {
    const { source, destination } = pasteOf(op, tabs, "cut")
    return tabsOfAreas([source, destination])
  },
  describe: (op, { tabs }) => pasteLine("cut", pasteOf(op, tabs, "cut"), op),
  loses(op, { tabs }) {
    const paste = pasteOf(op, tabs, "cut")
    return [{ area: paste.source }, { area: paste.destination, keeps: countedWithSource(paste) }]
  },
})
