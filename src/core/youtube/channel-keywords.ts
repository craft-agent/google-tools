/** Matches a keyword as Google writes the list: a phrase in double quotes, or a word. */
const KEYWORD_PATTERN = /"([^"]*)"|(\S+)/g

/** Whether a keyword holds whitespace, which Google writes it in double quotes for. */
const SPACED = /\s/

/** The words of the keywords text of a channel, a quoted phrase as one. */
export function keywordsOf(text: string | undefined): string[] {
  return [...(text ?? "").matchAll(KEYWORD_PATTERN)].flatMap((match) => {
    const keyword = (match[1] ?? match[2] ?? "").trim()
    return keyword === "" ? [] : [keyword]
  })
}

/** The text Google stores for `keywords`: one string, a space between two and a keyword with whitespace in double quotes; what `keywordsOf` reads back. */
export function keywordsText(keywords: readonly string[]): string {
  return keywords.map((keyword) => (SPACED.test(keyword) ? `"${keyword}"` : keyword)).join(" ")
}

/** The keywords after an edit: those of `current` that `remove` does not name, then the `add` ones, in order and each once. */
export function mergedKeywords(
  current: readonly string[],
  add: readonly string[],
  remove: readonly string[],
): string[] {
  const removed = new Set(remove)
  return [...new Set([...current.filter((keyword) => !removed.has(keyword)), ...add])]
}
