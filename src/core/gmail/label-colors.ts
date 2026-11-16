import { ToolError } from "../errors"

/** The colors Gmail accepts for a label's text and its background, from the `Label.Color` reference of the Gmail API. */
export const LABEL_PALETTE: readonly string[] = [
  "#000000",
  "#434343",
  "#666666",
  "#999999",
  "#cccccc",
  "#efefef",
  "#f3f3f3",
  "#ffffff",
  "#fb4c2f",
  "#ffad47",
  "#fad165",
  "#16a766",
  "#43d692",
  "#4a86e8",
  "#a479e2",
  "#f691b3",
  "#f6c5be",
  "#ffe6c7",
  "#fef1d1",
  "#b9e4d0",
  "#c6f3de",
  "#c9daf8",
  "#e4d7f5",
  "#fcdee8",
  "#efa093",
  "#ffd6a2",
  "#fce8b3",
  "#89d3b2",
  "#a0eac9",
  "#a4c2f4",
  "#d0bcf1",
  "#fbc8d9",
  "#e66550",
  "#ffbc6b",
  "#fcda83",
  "#44b984",
  "#68dfa9",
  "#6d9eeb",
  "#b694e8",
  "#f7a7c0",
  "#cc3a21",
  "#eaa041",
  "#f2c960",
  "#149e60",
  "#3dc789",
  "#3c78d8",
  "#8e63ce",
  "#e07798",
  "#ac2b16",
  "#cf8933",
  "#d5ae49",
  "#0b804b",
  "#2a9c68",
  "#285bac",
  "#653e9b",
  "#b65775",
  "#822111",
  "#a46a21",
  "#aa8831",
  "#076239",
  "#1a764d",
  "#1c4587",
  "#41236d",
  "#83334c",
  "#464646",
  "#e7e7e7",
  "#0d3472",
  "#b6cff5",
  "#0d3b44",
  "#98d7e4",
  "#3d188e",
  "#e3d7ff",
  "#711a36",
  "#fbd3e0",
  "#8a1c0a",
  "#f2b2a8",
  "#7a2e0b",
  "#ffc8af",
  "#7a4706",
  "#ffdeb5",
  "#594c05",
  "#fbe983",
  "#684e07",
  "#fdedc1",
  "#0b4f30",
  "#b3efd3",
  "#04502e",
  "#a2dcc1",
  "#c2c2c2",
  "#4986e7",
  "#2da2bb",
  "#b99aff",
  "#994a64",
  "#f691b2",
  "#ff7537",
  "#ffad46",
  "#662e37",
  "#ebdbde",
  "#cca6ac",
  "#094228",
  "#42d692",
  "#16a765",
]

/** A label's colors as Gmail takes them. */
export type LabelColors = { textColor: string; backgroundColor: string }

/** `value` in lower case when it is in `LABEL_PALETTE`, else `invalid_argument` naming `argument` and listing the palette. */
function paletteColor(argument: string, value: string): string {
  const color = value.toLowerCase()
  if (LABEL_PALETTE.includes(color)) return color
  throw new ToolError(
    "invalid_argument",
    `\`${argument}\` ${JSON.stringify(value)} is not a color Gmail accepts for a label. Colors must be from Gmail's palette: ${LABEL_PALETTE.join(", ")}.`,
  )
}

/** The colors a call gives, as `LabelColors`; `undefined` when it gives none. Only both or neither, and only from `LABEL_PALETTE` (any letter case), are accepted. */
export function labelColors(args: { text_color?: string; background_color?: string }): LabelColors | undefined {
  const { text_color: text, background_color: background } = args
  if (text === undefined && background === undefined) return undefined
  if (text === undefined || background === undefined) {
    throw new ToolError("invalid_argument", "Give both `text_color` and `background_color`, or neither.")
  }
  return { textColor: paletteColor("text_color", text), backgroundColor: paletteColor("background_color", background) }
}
