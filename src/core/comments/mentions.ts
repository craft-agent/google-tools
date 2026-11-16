/** A `+address@domain` or `@address@domain` at the start of the text or after whitespace; the capture is the address, with whatever punctuation follows it. */
const MENTION_PATTERN = /(?:^|\s)[+@]([^\s@]+@[^\s@]+\.[^\s@]+)/g

/** The punctuation that ends a sentence or closes a bracket and is no part of an address. */
const TRAILING_PUNCTUATION = /[.,;:!?)]+$/

/** What is left of a mention once its trailing punctuation is stripped, still an address. */
const ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * The addresses `text` mentions, which Google emails: each `+name@example.com`
 * or `@name@example.com` at the start or after whitespace, without the
 * punctuation that ends it, lower-cased, each once, in the order they appear.
 */
export function mentionedAddresses(text: string): string[] {
  const addresses = new Set<string>()
  for (const [, mention = ""] of text.matchAll(MENTION_PATTERN)) {
    const address = mention.replace(TRAILING_PUNCTUATION, "").toLowerCase()
    if (ADDRESS_PATTERN.test(address)) addresses.add(address)
  }
  return [...addresses]
}
