/** How many messages or drafts are fetched at once. */
const FETCH_CONCURRENCY = 5

/** `fetch` applied to each of `ids`, a few at a time, the answers in the order of `ids`. */
export async function fetchInBatches<T>(ids: readonly string[], fetch: (id: string) => Promise<T>): Promise<T[]> {
  const found: T[] = []
  for (let start = 0; start < ids.length; start += FETCH_CONCURRENCY) {
    found.push(...(await Promise.all(ids.slice(start, start + FETCH_CONCURRENCY).map(fetch))))
  }
  return found
}
