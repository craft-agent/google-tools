import { z } from "zod"
import { cut } from "../describe"
import { ToolError } from "../errors"
import { colorArg, normalizedColor, toColorStyle } from "./colors"
import { defineOperation, type OperationContext } from "./operations"
import { MAX_FONT_LENGTH, MAX_FONT_SIZE, TEXT_FLAGS } from "./operations.cells"
import { onlyClosedArea, sizeOf, type ClosedArea } from "./operation-blocks"
import {
  ONE_RANGE_MESSAGE,
  areaLabel,
  areasOf,
  hasOneRange,
  rangeFields,
  rangeText,
  rangesLabel,
  tabsOfAreas,
} from "./operation-ranges"
import { MAX_CELL_TEXT_LENGTH } from "./schemas"
import type { SheetTab } from "./tabs"

/** The most runs of styled text one cell takes. */
const MAX_RUNS = 50

/** The most characters of a link. */
const MAX_LINK_LENGTH = 2_000

/** How many characters of a note or of a cell's text a line shows. */
const SHOWN_NOTE_LENGTH = 60
const SHOWN_RUN_LENGTH = 20

/** The addresses a link may have: a web page or a mail address. */
const LINK_PATTERN = /^(https?:\/\/|mailto:)\S+$/

/** Every style a run may set, in the order a line lists them. */
const RUN_STYLES = [...TEXT_FLAGS, "font_size", "font", "color", "link"] as const

const noteSchema = z
  .strictObject({
    op: z.literal("note"),
    ...rangeFields,
    text: z
      .string()
      .trim()
      .max(MAX_CELL_TEXT_LENGTH)
      .describe("The note, which replaces the one the cells have; an empty text removes the notes."),
  })
  .refine(hasOneRange, { message: ONE_RANGE_MESSAGE })

/** The notes of the ranges as read right before the plan, which a call pins. */
function notesOf(op: object, context: OperationContext): unknown[] {
  return context.read.get(op)?.notes?.definitions ?? []
}

/** `note`: sets the note of the cells of the ranges, or removes it with an empty text. */
export const noteOperation = defineOperation({
  schema: noteSchema,
  needs: ["objects"],
  reads: (op, { tabs }) => ({ notes: areasOf(op, tabs) }),
  requests: (op, { tabs }) =>
    areasOf(op, tabs).map(({ grid }) => ({
      repeatCell: { range: grid, cell: op.text === "" ? {} : { note: op.text }, fields: "note" },
    })),
  tabs: (op, { tabs }) => tabsOfAreas(areasOf(op, tabs)),
  describe: (op, { tabs }) =>
    `note ${rangesLabel(areasOf(op, tabs))} ${op.text === "" ? "remove" : JSON.stringify(cut(op.text, SHOWN_NOTE_LENGTH))}`,
  pins: (op, context) => [notesOf(op, context)],
})

const runSchema = z
  .strictObject({
    text: z
      .string()
      .min(1)
      .max(MAX_CELL_TEXT_LENGTH)
      .describe("The part of the cell's text to style: its first occurrence that no earlier run styles."),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    strikethrough: z.boolean().optional(),
    font_size: z.number().int().min(1).max(MAX_FONT_SIZE).optional().describe("The font size in points."),
    font: z.string().min(1).max(MAX_FONT_LENGTH).optional().describe("The font family, such as `Roboto`."),
    color: colorArg.optional().describe("The text color, `#rrggbb`."),
    link: z
      .string()
      .max(MAX_LINK_LENGTH)
      .regex(LINK_PATTERN, "A link is an http(s):// or mailto: address.")
      .optional()
      .describe("An http(s):// or mailto: address the text links to."),
  })
  .refine((run) => RUN_STYLES.some((style) => run[style] !== undefined), {
    message: "Give each run at least one style.",
  })

type Run = z.output<typeof runSchema>

const richTextSchema = z.strictObject({
  op: z.literal("rich_text"),
  range: rangeText.describe("One cell (`Plan!B2`)."),
  runs: z
    .array(runSchema)
    .min(1)
    .max(MAX_RUNS)
    .describe(
      `1 to ${MAX_RUNS} runs, each styling a part of the cell's text; the rest of the text keeps the cell's own format.`,
    ),
  value: z
    .string()
    .min(1)
    .max(MAX_CELL_TEXT_LENGTH)
    .optional()
    .describe("The cell's new text; left out, the cell's current text, which must be plain text, is restyled."),
})

type RichTextOperation = z.output<typeof richTextSchema>

/** A run's style as Google's `TextFormat` takes it. */
function textFormatOf(run: Run): Record<string, unknown> {
  return {
    ...Object.fromEntries(TEXT_FLAGS.filter((flag) => run[flag] !== undefined).map((flag) => [flag, run[flag]])),
    ...(run.font_size !== undefined && { fontSize: run.font_size }),
    ...(run.font !== undefined && { fontFamily: run.font }),
    ...(run.color !== undefined && { foregroundColorStyle: toColorStyle(run.color) }),
    ...(run.link !== undefined && { link: { uri: run.link } }),
  }
}

/** What a line says of a run: its text, then its styles. */
function runWords(run: Run): string {
  const styles = [
    ...TEXT_FLAGS.filter((flag) => run[flag] !== undefined).map((flag) => (run[flag] ? flag : `no ${flag}`)),
    ...(run.font_size === undefined ? [] : [`size ${run.font_size}`]),
    ...(run.font === undefined ? [] : [`font ${JSON.stringify(run.font)}`]),
    ...(run.color === undefined ? [] : [`color ${normalizedColor(run.color)}`]),
    ...(run.link === undefined ? [] : [`link ${run.link}`]),
  ]
  return `${JSON.stringify(cut(run.text, SHOWN_RUN_LENGTH))} ${styles.join(" ")}`
}

/**
 * Google's `textFormatRuns` for the runs on `text`: each run goes on the first
 * occurrence of its text that no earlier run covers, a run whose text is not
 * there is refused, and the text after a run goes back to the cell's own format.
 * The start indexes count UTF-16 units, which is how Google counts and how a
 * string indexes here.
 */
function textFormatRuns(text: string, runs: readonly Run[]): { startIndex: number; format: Record<string, unknown> }[] {
  const placed: { start: number; end: number; format: Record<string, unknown> }[] = []
  for (const run of runs) {
    let start = text.indexOf(run.text)
    while (start >= 0 && placed.some((other) => other.start < start + run.text.length && start < other.end)) {
      start = text.indexOf(run.text, start + 1)
    }
    if (start < 0) {
      throw new ToolError(
        "invalid_argument",
        `${JSON.stringify(cut(run.text, SHOWN_NOTE_LENGTH))} is not in the cell's text ${JSON.stringify(cut(text, SHOWN_NOTE_LENGTH))}.`,
      )
    }
    placed.push({ start, end: start + run.text.length, format: textFormatOf(run) })
  }
  placed.sort((a, b) => a.start - b.start)
  return placed.flatMap(({ start, end, format }, position) => [
    { startIndex: start, format },
    ...(end < (placed[position + 1]?.start ?? text.length) ? [{ startIndex: end, format: {} }] : []),
  ])
}

/** The one cell of a `rich_text`, refusing a block of more. */
function cellOf(op: RichTextOperation, tabs: readonly SheetTab[]): ClosedArea {
  const area = onlyClosedArea(op, tabs, "rich_text")
  const { rows, columns } = sizeOf(area.grid)
  if (rows !== 1 || columns !== 1) {
    throw new ToolError("invalid_argument", `rich_text takes one cell, such as \`Plan!B2\`, not ${areaLabel(area)}.`)
  }
  return area
}

/** The text a `rich_text` styles: its `value`, else the plain text the cell holds, which a formula, a number, a date or an empty cell does not. */
function textOf(op: RichTextOperation, area: ClosedArea, context: OperationContext): string {
  if (op.value !== undefined) return op.value
  const current = context.read.get(op)?.text
  if (current === undefined || current === null || current === "" || current.startsWith("=")) {
    throw new ToolError(
      "invalid_argument",
      `${areaLabel(area)} holds no plain text (a number, a date, a formula or nothing); give \`value\` to write the text.`,
    )
  }
  return current
}

/** `rich_text`: writes a cell's text with parts of it styled, which replaces any partial styling it has. */
export const richTextOperation = defineOperation({
  schema: richTextSchema,
  reads: (op, { tabs }) => ({ ...(op.value === undefined && { text: cellOf(op, tabs) }) }),
  requests(op, context) {
    const area = cellOf(op, context.tabs)
    const text = textOf(op, area, context)
    return [
      {
        updateCells: {
          range: area.grid,
          fields: "userEnteredValue,textFormatRuns",
          rows: [
            {
              values: [{ userEnteredValue: { stringValue: text }, textFormatRuns: textFormatRuns(text, op.runs) }],
            },
          ],
        },
      },
    ]
  },
  tabs: (op, { tabs }) => [cellOf(op, tabs).tab],
  describe(op, { tabs }) {
    const replaced = op.value === undefined ? "" : ` with text ${JSON.stringify(cut(op.value, SHOWN_NOTE_LENGTH))}`
    return `rich_text ${areaLabel(cellOf(op, tabs))}${replaced}: ${op.runs.map(runWords).join(", ")}`
  },
  loses: (op, { tabs }) => [{ area: cellOf(op, tabs) }],
})
