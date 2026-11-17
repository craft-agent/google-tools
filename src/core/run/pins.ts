/** The pin that holds a service's etag, so a call whose service changed after the prompt is `stale`. */
const ETAG_PIN = "etag"

/** The etag pin of a service that has no etag, or does not exist yet. */
const ABSENT = "absent"

/** The pin of a service's etag, `absent` for none. */
export function etagPin(etag: string | null): Record<string, string> {
  return { [ETAG_PIN]: etag ?? ABSENT }
}
