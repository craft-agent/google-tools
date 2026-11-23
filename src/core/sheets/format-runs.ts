import { z } from "zod"
import { colorOf, colorReply, colorStyleReply } from "./colors"
import type { FormattedCell, FormattedRun } from "./schemas"
import { MAX_CELL_LENGTH } from "./values"

/** Google's text format, shared by a cell and its rich-text runs. */
export const textFormatReply = z.object({
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
  fontFamily: z.string().optional(),
  fontSize: z.number().optional(),
  foregroundColor: colorReply.optional(),
  foregroundColorStyle: colorStyleReply.optional(),
  link: z.object({ uri: z.string().optional() }).optional(),
})

/** Google's rich-text spans; an omitted start index means zero. */
export const textRunReply = z.object({
  startIndex: z.number().int().optional(),
  format: textFormatReply.optional(),
})

/** The compact style vocabulary shared by a cell's text and a rich-text run. */
export function textFormatView(
  format: z.output<typeof textFormatReply> | undefined,
): Omit<FormattedRun, "start" | "text" | "link"> {
  const view: Omit<FormattedRun, "start" | "text" | "link"> = {}
  for (const key of ["bold", "italic", "underline", "strikethrough"] as const) {
    if (format?.[key] !== undefined) view[key] = format[key]
  }
  if (format?.fontSize !== undefined) view.font_size = format.fontSize
  if (format?.fontFamily !== undefined) view.font = format.fontFamily
  const color = colorOf(format?.foregroundColorStyle) ?? colorOf(format?.foregroundColor)
  if (color !== undefined) view.color = color
  return view
}

/** Only styled, nonempty spans within the cell's text budget; no plain text leaves this view. */
export function formattedRuns(
  text: string,
  source: z.output<typeof textRunReply>[],
): Pick<FormattedCell, "runs" | "runs_clipped"> {
  const runs: FormattedRun[] = []
  let clipped = false
  for (const [index, run] of source.entries()) {
    const start = run.startIndex ?? 0
    const end = source[index + 1]?.startIndex ?? text.length
    const style: Omit<FormattedRun, "start" | "text"> = textFormatView(run.format)
    if (run.format?.link?.uri !== undefined) style.link = run.format.link.uri
    if (Object.keys(style).length === 0 || end <= start) continue
    if (start >= MAX_CELL_LENGTH || end > MAX_CELL_LENGTH) clipped = true
    const span = text.slice(start, Math.min(end, MAX_CELL_LENGTH))
    if (span !== "") runs.push({ start, text: span, ...style })
  }
  return { runs: runs.length === 0 ? null : runs, ...(clipped && { runs_clipped: true }) }
}
