/** An opening `<script>` or `<style>` tag, whose content is not text. */
const BLOCK_OPENING = /<(script|style)\b[^<>]*>/gi

/** A tag that ends a line: `<br>`, and the end of a paragraph, a division or a table row. */
const LINE_BREAK = /<br\b[^<>]*>|<\/(?:p|div|tr)\s*>/gi

const TAG = /<[^<>]*>/g

const ENTITY = /&(?:#x([0-9a-f]{1,6})|#([0-9]{1,7})|([a-z][a-z0-9]{1,9}));/gi

const BLANK_LINES = /\n{3,}/g

/** The most code point a character reference may name. */
const MAX_CODE_POINT = 0x10ffff

const SURROGATES = { first: 0xd800, last: 0xdfff }

/** What a reference to an invalid code point reads as. */
const REPLACEMENT_CHARACTER = "\uFFFD"

/** The named references mail commonly holds; any other is left as written. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
}

/** `text` with the ASCII capitals made small and nothing else changed, so an index into it is an index into `text`. */
function asciiLowerCase(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => letter.toLowerCase())
}

/**
 * `html` without its `<script>` and `<style>` blocks. A block with no closing
 * tag is left as it is. Every step is linear in `html`, which another person
 * wrote: a mail of many unclosed tags must not make the scan quadratic.
 */
function withoutBlocks(html: string): string {
  const lower = asciiLowerCase(html)
  const mayClose: Record<string, boolean> = { script: true, style: true }
  let text = ""
  let kept = 0
  for (const opening of html.matchAll(BLOCK_OPENING)) {
    const name = opening[1]!.toLowerCase()
    if (opening.index < kept || !mayClose[name]) continue
    const closing = lower.indexOf(`</${name}`, opening.index + opening[0].length)
    if (closing === -1) {
      mayClose[name] = false
      continue
    }
    const end = lower.indexOf(">", closing)
    text += html.slice(kept, opening.index)
    kept = end === -1 ? html.length : end + 1
  }
  return text + html.slice(kept)
}

function decodeEntity(entity: string, hex?: string, decimal?: string, name?: string): string {
  if (name !== undefined) return NAMED_ENTITIES[name.toLowerCase()] ?? entity
  const codePoint = hex !== undefined ? Number.parseInt(hex, 16) : Number(decimal)
  const invalid =
    codePoint === 0 || codePoint > MAX_CODE_POINT || (codePoint >= SURROGATES.first && codePoint <= SURROGATES.last)
  return invalid ? REPLACEMENT_CHARACTER : String.fromCodePoint(codePoint)
}

/**
 * The text of an HTML mail: `<script>` and `<style>` blocks dropped, line
 * ends kept, other tags removed, character references decoded (the common
 * named ones and every numeric one) and runs of blank lines folded to one.
 */
export function htmlToText(html: string): string {
  const stripped = withoutBlocks(html).replace(LINE_BREAK, "\n").replace(TAG, "")
  return stripped.replace(ENTITY, decodeEntity).replace(BLANK_LINES, "\n\n").trim()
}
