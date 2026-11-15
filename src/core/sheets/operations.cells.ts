import { z } from "zod"
import { colorArg, normalizedColor, toColorStyle } from "./colors"
import { defineOperation } from "./operations"
import { ONE_RANGE_MESSAGE, areasOf, hasOneRange, rangeFields, rangesLabel, tabsOfAreas } from "./operation-ranges"

const MAX_FONT_LENGTH = 100
const MAX_PATTERN_LENGTH = 200
const MAX_FONT_SIZE = 400
const MAX_ROTATION = 90
const MAX_PADDING = 100

/** The boolean text properties of the `format` operation, in the order they are written. */
const TEXT_FLAGS = ["bold", "italic", "underline", "strikethrough"] as const

/** Every property of the `format` operation besides its ranges and `reset`. */
const FORMAT_PROPERTIES = [
  ...TEXT_FLAGS,
  "font",
  "font_size",
  "color",
  "background",
  "rotation",
  "padding",
  "horizontal_align",
  "vertical_align",
  "wrap",
  "number_format",
] as const

/** The names of Google's enums are these words in capitals (`date_time` is `DATE_TIME`), except where noted. */
const NUMBER_FORMAT_TYPES = [
  "text",
  "number",
  "percent",
  "currency",
  "date",
  "time",
  "date_time",
  "scientific",
] as const
const BORDER_STYLES = ["solid", "solid_medium", "solid_thick", "dashed", "dotted", "double"] as const
const BORDER_SIDE_WORDS = [
  "top",
  "bottom",
  "left",
  "right",
  "inner_horizontal",
  "inner_vertical",
  "all",
  "outer",
  "inner",
  "none",
] as const

type SideWord = (typeof BORDER_SIDE_WORDS)[number]

/** Google's name for the wrap choice `overflow`; the others are their words in capitals. */
const OVERFLOW_STRATEGY = "OVERFLOW_CELL"

const INNER_BORDERS = ["innerHorizontal", "innerVertical"]
const OUTER_BORDERS = ["top", "bottom", "left", "right"]

/** The borders of Google's `updateBorders` each side word stands for; `none` stands for all of them, drawn as no line. */
const BORDER_SIDES: Record<SideWord, readonly string[]> = {
  top: ["top"],
  bottom: ["bottom"],
  left: ["left"],
  right: ["right"],
  inner_horizontal: ["innerHorizontal"],
  inner_vertical: ["innerVertical"],
  outer: OUTER_BORDERS,
  inner: INNER_BORDERS,
  all: [...OUTER_BORDERS, ...INNER_BORDERS],
  none: [...OUTER_BORDERS, ...INNER_BORDERS],
}

const DEFAULT_BORDER_STYLE = "solid"
const DEFAULT_BORDER_COLOR = "#000000"

const paddingSide = z.number().int().min(0).max(MAX_PADDING).optional()

const formatSchema = z
  .strictObject({
    op: z.literal("format"),
    ...rangeFields,
    bold: z.boolean().optional().describe("Bold text."),
    italic: z.boolean().optional().describe("Italic text."),
    underline: z.boolean().optional().describe("Underlined text."),
    strikethrough: z.boolean().optional().describe("Struck-through text."),
    font: z.string().min(1).max(MAX_FONT_LENGTH).optional().describe("The font family, such as `Roboto`."),
    font_size: z
      .number()
      .int()
      .min(1)
      .max(MAX_FONT_SIZE)
      .optional()
      .describe(`The font size in points (1 to ${MAX_FONT_SIZE}).`),
    color: colorArg.nullable().optional().describe("The text color, `#rrggbb`; `null` clears it."),
    background: colorArg.nullable().optional().describe("The background color, `#rrggbb`; `null` clears it."),
    horizontal_align: z.enum(["left", "center", "right"]).optional(),
    vertical_align: z.enum(["top", "middle", "bottom"]).optional(),
    wrap: z
      .enum(["overflow", "clip", "wrap"])
      .optional()
      .describe("`overflow` into the next cell, `clip` the text, or `wrap` it onto more lines."),
    number_format: z
      .strictObject({
        type: z.enum(NUMBER_FORMAT_TYPES),
        pattern: z
          .string()
          .min(1)
          .max(MAX_PATTERN_LENGTH)
          .optional()
          .describe("A format pattern such as `0.00`, `yyyy-mm-dd` or `#,##0`."),
      })
      .optional()
      .describe("How numbers and dates are shown."),
    rotation: z
      .union([z.number().int().min(-MAX_ROTATION).max(MAX_ROTATION), z.literal("vertical")])
      .optional()
      .describe(`The text angle in degrees (-${MAX_ROTATION} to ${MAX_ROTATION}), or \`vertical\` to stack it.`),
    padding: z
      .strictObject({ top: paddingSide, right: paddingSide, bottom: paddingSide, left: paddingSide })
      .refine((padding) => Object.values(padding).some((side) => side !== undefined), {
        message: "Give at least one side of the padding.",
      })
      .optional()
      .describe(`The padding in pixels (0 to ${MAX_PADDING}) of each side given; a side left out becomes 0.`),
    reset: z
      .boolean()
      .optional()
      .describe("`true` clears every format of the ranges first; the other properties then apply."),
  })
  .refine(hasOneRange, { message: ONE_RANGE_MESSAGE })
  .refine((op) => op.reset === true || FORMAT_PROPERTIES.some((property) => op[property] !== undefined), {
    message: "Give at least one property to set, or `reset: true`.",
  })

type FormatOperation = z.output<typeof formatSchema>

/** The cell format an operation writes, the field paths under `userEnteredFormat` it names, and how it reads in a description. */
function formatOf(op: FormatOperation): { format: Record<string, unknown>; fields: string[]; words: string[] } {
  const text: Record<string, unknown> = {}
  const format: Record<string, unknown> = {}
  const fields: string[] = []
  const words: string[] = []
  for (const flag of TEXT_FLAGS) {
    if (op[flag] === undefined) continue
    text[flag] = op[flag]
    fields.push(`textFormat.${flag}`)
    words.push(op[flag] ? flag : `no ${flag}`)
  }
  if (op.font_size !== undefined) {
    text.fontSize = op.font_size
    fields.push("textFormat.fontSize")
    words.push(`size ${op.font_size}`)
  }
  if (op.font !== undefined) {
    text.fontFamily = op.font
    fields.push("textFormat.fontFamily")
    words.push(`font ${JSON.stringify(op.font)}`)
  }
  if (op.color !== undefined) {
    if (op.color !== null) text.foregroundColorStyle = toColorStyle(op.color)
    fields.push("textFormat.foregroundColor", "textFormat.foregroundColorStyle")
    words.push(op.color === null ? "no color" : `color ${normalizedColor(op.color)}`)
  }
  if (Object.keys(text).length > 0) format.textFormat = text
  if (op.background !== undefined) {
    if (op.background !== null) format.backgroundColorStyle = toColorStyle(op.background)
    fields.push("backgroundColor", "backgroundColorStyle")
    words.push(op.background === null ? "no background" : `background ${normalizedColor(op.background)}`)
  }
  if (op.rotation !== undefined) {
    format.textRotation = op.rotation === "vertical" ? { vertical: true } : { angle: op.rotation }
    fields.push("textRotation")
    words.push(op.rotation === "vertical" ? "vertical text" : `rotate ${op.rotation}°`)
  }
  if (op.padding !== undefined) {
    const { top = 0, right = 0, bottom = 0, left = 0 } = op.padding
    format.padding = { top, right, bottom, left }
    fields.push("padding")
    words.push(`padding ${top}/${right}/${bottom}/${left}px`)
  }
  if (op.horizontal_align !== undefined) {
    format.horizontalAlignment = op.horizontal_align.toUpperCase()
    fields.push("horizontalAlignment")
    words.push(`align ${op.horizontal_align}`)
  }
  if (op.vertical_align !== undefined) {
    format.verticalAlignment = op.vertical_align.toUpperCase()
    fields.push("verticalAlignment")
    words.push(`valign ${op.vertical_align}`)
  }
  if (op.wrap !== undefined) {
    format.wrapStrategy = op.wrap === "overflow" ? OVERFLOW_STRATEGY : op.wrap.toUpperCase()
    fields.push("wrapStrategy")
    words.push(`wrap ${op.wrap}`)
  }
  if (op.number_format !== undefined) {
    const { type, pattern } = op.number_format
    format.numberFormat = { type: type.toUpperCase(), ...(pattern !== undefined && { pattern }) }
    fields.push("numberFormat")
    words.push(`number ${type}${pattern === undefined ? "" : ` ${JSON.stringify(pattern)}`}`)
  }
  return { format, fields, words }
}

/** `format`: sets the properties given on the cells of the ranges, touching no other property; `reset` clears them all first. */
export const formatOperation = defineOperation({
  schema: formatSchema,
  requests(op, { tabs }) {
    const { format, fields } = formatOf(op)
    return areasOf(op, tabs).flatMap(({ grid }) => [
      ...(op.reset === true ? [{ repeatCell: { range: grid, cell: {}, fields: "userEnteredFormat" } }] : []),
      ...(fields.length === 0
        ? []
        : [
            {
              repeatCell: {
                range: grid,
                cell: { userEnteredFormat: format },
                fields: fields.map((field) => `userEnteredFormat.${field}`).join(","),
              },
            },
          ]),
    ])
  },
  tabs: (op, { tabs }) => tabsOfAreas(areasOf(op, tabs)),
  describe(op, { tabs }) {
    const words = [...(op.reset === true ? ["reset"] : []), ...formatOf(op).words]
    return `format ${rangesLabel(areasOf(op, tabs))} ${words.join(", ")}`
  },
})

const sideWord = z.enum(BORDER_SIDE_WORDS)

const bordersSchema = z
  .strictObject({
    op: z.literal("borders"),
    ...rangeFields,
    sides: z
      .union([sideWord, z.array(sideWord).min(1).max(BORDER_SIDE_WORDS.length)])
      .optional()
      .describe(
        "The sides to draw: one of or a list of `top`, `bottom`, `left`, `right`, `inner_horizontal`, `inner_vertical`, `all` (the default), `outer`, `inner`; `none` alone removes the borders.",
      ),
    style: z.enum(BORDER_STYLES).optional().describe(`The line style; default ${DEFAULT_BORDER_STYLE}.`),
    color: colorArg.optional().describe(`The line color, \`#rrggbb\`; default ${DEFAULT_BORDER_COLOR}.`),
  })
  .refine(hasOneRange, { message: ONE_RANGE_MESSAGE })
  .refine(
    (op) =>
      !sidesOf(op).includes("none") || (sidesOf(op).length === 1 && op.style === undefined && op.color === undefined),
    { message: "`none` removes the borders: give it as the only side, with no `style` or `color`." },
  )

/** The side words of the operation: those given, or `all`. */
function sidesOf(op: { sides?: SideWord | SideWord[] }): SideWord[] {
  if (op.sides === undefined) return ["all"]
  return typeof op.sides === "string" ? [op.sides] : op.sides
}

/** `borders`: draws the borders of the sides of the ranges, or removes them. */
export const bordersOperation = defineOperation({
  schema: bordersSchema,
  requests(op, { tabs }) {
    const sides = sidesOf(op)
    const border = sides.includes("none")
      ? { style: "NONE" }
      : {
          style: (op.style ?? DEFAULT_BORDER_STYLE).toUpperCase(),
          colorStyle: toColorStyle(op.color ?? DEFAULT_BORDER_COLOR),
        }
    const named = [...new Set(sides.flatMap((side) => BORDER_SIDES[side]))].sort()
    return areasOf(op, tabs).map(({ grid }) => ({
      updateBorders: { range: grid, ...Object.fromEntries(named.map((side) => [side, border])) },
    }))
  },
  tabs: (op, { tabs }) => tabsOfAreas(areasOf(op, tabs)),
  describe(op, { tabs }) {
    const sides = sidesOf(op)
    const look = sides.includes("none")
      ? "none"
      : `${sides.join("+")} ${op.style ?? DEFAULT_BORDER_STYLE} ${normalizedColor(op.color ?? DEFAULT_BORDER_COLOR)}`
    return `borders ${rangesLabel(areasOf(op, tabs))} ${look}`
  },
})

const unmergeSchema = z
  .strictObject({ op: z.literal("unmerge"), ...rangeFields })
  .refine(hasOneRange, { message: ONE_RANGE_MESSAGE })

/** `unmerge`: splits the merged blocks that lie in the ranges. */
export const unmergeOperation = defineOperation({
  schema: unmergeSchema,
  requests: (op, { tabs }) => areasOf(op, tabs).map(({ grid }) => ({ unmergeCells: { range: grid } })),
  tabs: (op, { tabs }) => tabsOfAreas(areasOf(op, tabs)),
  describe: (op, { tabs }) => `unmerge ${rangesLabel(areasOf(op, tabs))}`,
})
