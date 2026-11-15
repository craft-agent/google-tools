import { z } from "zod"
import { cut } from "../describe"
import { CHART_TYPES, DEFAULT_CHART_TYPE, LEGEND_NAMES, isStackable, type ChartType } from "./chart-spec"
import { rangeText } from "./operation-ranges"

const MIN_CHART_PIXELS = 50
const MAX_CHART_PIXELS = 4_000

const MAX_CHART_TITLE_LENGTH = 200

/** How many characters of a chart's title a line shows. */
const SHOWN_TITLE_LENGTH = 40

/** What a line says of a chart that sits on a tab of its own. */
export const OWN_TAB_WORDS = "on a new tab of its own"

/** The look of a chart that `chart` and `chart_update` both set. */
export const chartLookFields = {
  chart_type: z
    .enum(CHART_TYPES)
    .optional()
    .describe(
      `\`${DEFAULT_CHART_TYPE}\` (the default of a new chart), \`bar\`, \`line\`, \`area\`, \`scatter\`, \`combo\` or \`pie\`.`,
    ),
  title: z
    .string()
    .trim()
    .max(MAX_CHART_TITLE_LENGTH)
    .optional()
    .describe("The chart's title; an empty text removes it."),
  legend: z
    .enum(LEGEND_NAMES)
    .optional()
    .describe("Where the legend goes: `bottom` (the default of a new chart), `top`, `left`, `right` or `none`."),
  stacked: z.boolean().optional().describe("Whether the series stack, for a `bar`, `column`, `area` or `combo` chart."),
  header: z
    .boolean()
    .optional()
    .describe("`true` (the default) when the range's first row is a header, `false` when it holds data."),
}

/** Where a chart sits and how large it is, which `chart` and `chart_move` both set. */
export const chartPlacementFields = {
  at: rangeText
    .optional()
    .describe("The cell the chart's top-left corner sits on (`Report!H2`); no tab means the tab of the data."),
  new_tab: z.literal(true).optional().describe("`true` puts the chart on a new tab of its own."),
  width: z
    .number()
    .int()
    .min(MIN_CHART_PIXELS)
    .max(MAX_CHART_PIXELS)
    .optional()
    .describe("The chart's width in pixels."),
  height: z
    .number()
    .int()
    .min(MIN_CHART_PIXELS)
    .max(MAX_CHART_PIXELS)
    .optional()
    .describe("The chart's height in pixels."),
}

type Look = { chart_type?: ChartType; title?: string; legend?: string; stacked?: boolean }

type Placement = { at?: string; new_tab?: true; width?: number; height?: number }

/** The chart a `chart_update`, `chart_move` or `chart_delete` names: its id, or its title. */
export const chartKey = z
  .union([z.string().min(1).max(MAX_CHART_TITLE_LENGTH), z.number().int()])
  .describe("The chart's id, or its title (as the `structure` read lists them).")

/** The schema, which also refuses a `stacked` chart whose type does not stack; a chart left without a type has `fallback`, none when the chart's own type decides. */
export function stackingOnly<S extends z.ZodType<Look>>(schema: S, fallback?: ChartType): S {
  return schema.refine(
    ({ chart_type = fallback, stacked }) =>
      stacked !== true || chart_type === undefined || isStackable(chart_type.toUpperCase()),
    { message: "`stacked` goes with a `bar`, `column`, `area` or `combo` chart." },
  )
}

/** The schema, which also refuses an `at` together with `new_tab`, and a size for a chart on a tab of its own. */
export function placedOnce<S extends z.ZodType<Placement>>(schema: S): S {
  return schema
    .refine(({ at, new_tab }) => at === undefined || new_tab === undefined, {
      message: "Give `at` or `new_tab`, not both.",
    })
    .refine(({ new_tab, width, height }) => new_tab === undefined || (width === undefined && height === undefined), {
      message: "A chart on a tab of its own takes no `width` or `height`.",
    })
}

/** The look a line says a chart gets besides its type, each part the call sets. */
export function lookWords(op: Look): string[] {
  return [
    ...(op.title === undefined
      ? []
      : [op.title === "" ? "no title" : `title ${JSON.stringify(cut(op.title, SHOWN_TITLE_LENGTH))}`]),
    ...(op.legend === undefined ? [] : [`legend ${op.legend}`]),
    ...(op.stacked === undefined ? [] : [op.stacked ? "stacked" : "not stacked"]),
  ]
}

/** The size a line says a chart gets, `800x400px`, with `…` for a side left as it is; none when neither is set. */
export function sizeWords({ width, height }: Placement): string | undefined {
  return width === undefined && height === undefined ? undefined : `${width ?? "…"}x${height ?? "…"}px`
}
