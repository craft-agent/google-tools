import { z } from "zod"

/** The most code points of a description a view returns; a longer one is clipped. */
export const MAX_DESCRIPTION_CHARACTERS = 2000

/** The most code points of one comment's text a view returns; a longer one is clipped. */
export const MAX_COMMENT_CHARACTERS = 1500

/** The keys of a reply that pages: the token of the next page. */
export const pageReply = { nextPageToken: z.string().optional() }

/** A count as Google writes it: a string of digits, or a number. */
export const countReply = z.union([z.string(), z.number()]).optional()

/** One page of a list under its key, with the token of the next. */
export type Listed<Key extends string, Item> = { [K in Key]: Item[] } & { next_page_token: string | null }

/** The result key of a view with a clipped description. */
export const descriptionShape = { description: z.string(), description_clipped: z.boolean() }

/** The result keys of a view with a clipped comment text. */
export const commentTextShape = { text: z.string(), text_clipped: z.boolean() }

export const videoUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`
export const channelUrl = (id: string) => `https://www.youtube.com/channel/${id}`
export const playlistUrl = (id: string) => `https://www.youtube.com/playlist?list=${id}`

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }

/**
 * `text` with its HTML entities decoded: `&amp; &lt; &gt; &quot; &#39; &apos;`
 * and numeric `&#NN;` / `&#xHH;`; an invalid code point is left as written.
 * Google's search snippets come escaped (`videos.list` does not), so only
 * search uses it.
 */
export function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(\w+));/g, (entity, decimal, hex, name) => {
    if (name !== undefined) return NAMED_ENTITIES[name] ?? entity
    const code = decimal !== undefined ? Number.parseInt(decimal, 10) : Number.parseInt(hex, 16)
    return code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : entity
  })
}

/** `text` cut at `max` code points, and whether it was cut. */
function clip(text: string, max: number): { text: string; clipped: boolean } {
  const characters = Array.from(text)
  if (characters.length <= max) return { text, clipped: false }
  return { text: characters.slice(0, max).join(""), clipped: true }
}

/** A description, cut at `MAX_DESCRIPTION_CHARACTERS`, with whether it was; none is an empty one. */
export function clippedDescription(text: string | undefined): { description: string; description_clipped: boolean } {
  const { text: description, clipped } = clip(text ?? "", MAX_DESCRIPTION_CHARACTERS)
  return { description, description_clipped: clipped }
}

/** A comment's text, cut at `MAX_COMMENT_CHARACTERS`, with whether it was; none is an empty one. */
export function clippedCommentText(text: string | undefined): { text: string; text_clipped: boolean } {
  const { text: clippedText, clipped } = clip(text ?? "", MAX_COMMENT_CHARACTERS)
  return { text: clippedText, text_clipped: clipped }
}

/** A count Google gives as a string of digits; `null` when it is absent or not a whole number. */
export function toCount(value: string | number | undefined): number | null {
  if (value === undefined || value === "") return null
  const count = Number(value)
  return Number.isSafeInteger(count) && count >= 0 ? count : null
}
