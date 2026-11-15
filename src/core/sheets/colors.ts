import { z } from "zod"

/** The theme colors Google's `ThemeColorType` names for a sheet's own palette. */
const THEME_COLORS = ["TEXT", "BACKGROUND", "ACCENT1", "ACCENT2", "ACCENT3", "ACCENT4", "ACCENT5", "ACCENT6", "LINK"]

const HEX_PATTERN = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i
const THEME_PATTERN = /^theme:([A-Za-z0-9]+)$/

const BYTE_MAX = 255
const BYTE_RADIX = 16
const BYTE_DIGITS = 2

/** A color as the tools write and read it: `#rrggbb` (`#rgb` is expanded), or `theme:ACCENT1` for a theme color the sheet reads. */
export const colorArg = z
  .string()
  .refine(
    (text) => HEX_PATTERN.test(text) || THEME_COLORS.includes(THEME_PATTERN.exec(text)?.[1]?.toUpperCase() ?? ""),
    {
      message: "A color is `#rrggbb` (or `#rgb`), or `theme:` and one of " + THEME_COLORS.join(", ") + ".",
    },
  )

/** Google's `Color`, as the API replies with it: each channel from 0 to 1, a zero channel left out. */
export const colorReply = z.object({
  red: z.number().optional(),
  green: z.number().optional(),
  blue: z.number().optional(),
})

/** Google's `ColorStyle`, as the API replies with it. */
export const colorStyleReply = z.object({ rgbColor: colorReply.optional(), themeColor: z.string().optional() })

/** Google's `ColorStyle` of a validated color: an `rgbColor` with channels from 0 to 1, or a `themeColor`. */
export function toColorStyle(text: string): Record<string, unknown> {
  const theme = THEME_PATTERN.exec(text)?.[1]
  if (theme !== undefined) return { themeColor: theme.toUpperCase() }
  const digits = expandedHex(text)
  const channel = (offset: number) => parseInt(digits.slice(offset, offset + BYTE_DIGITS), BYTE_RADIX) / BYTE_MAX
  return { rgbColor: { red: channel(0), green: channel(2), blue: channel(4) } }
}

/** The color as it is shown and read back: `#rrggbb` in lower case, or `theme:ACCENT1`. */
export function normalizedColor(text: string): string {
  const theme = THEME_PATTERN.exec(text)?.[1]
  return theme === undefined ? `#${expandedHex(text)}` : `theme:${theme.toUpperCase()}`
}

/** The six lower-case hex digits of `#rgb` or `#rrggbb`. */
function expandedHex(text: string): string {
  const digits = text.slice(1).toLowerCase()
  return digits.length === 3 ? [...digits].map((digit) => digit + digit).join("") : digits
}

/**
 * The text of a color Google replied with, a `ColorStyle` or the legacy
 * `Color`: `#rrggbb`, `theme:ACCENT1`, or `undefined` for none. An `rgbColor`
 * with no channel is black, since Google leaves a zero out.
 */
export function colorOf(
  style: z.output<typeof colorStyleReply> | z.output<typeof colorReply> | undefined,
): string | undefined {
  if (style === undefined || Object.keys(style).length === 0) return undefined
  if ("themeColor" in style && style.themeColor !== undefined) return `theme:${style.themeColor}`
  const rgb = "rgbColor" in style ? style.rgbColor : (style as z.output<typeof colorReply>)
  if (rgb === undefined) return undefined
  const hex = (channel = 0) =>
    Math.round(channel * BYTE_MAX)
      .toString(BYTE_RADIX)
      .padStart(BYTE_DIGITS, "0")
  return `#${hex(rgb.red)}${hex(rgb.green)}${hex(rgb.blue)}`
}
