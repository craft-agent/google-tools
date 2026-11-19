/** The pin that holds a service's etag, so a call whose service changed after the prompt is `stale`. */
const ETAG_PIN = "etag"

/** The etag pin of a service that has no etag, or does not exist yet. */
const ABSENT = "absent"

/** The pin that holds the etag of the service a revision belongs to, so traffic moved after the prompt makes a revision's deletion `stale`. */
const SERVICE_ETAG_PIN = "service_etag"

/** The pin of a service's etag, `absent` for none. */
export function etagPin(etag: string | null): Record<string, string> {
  return { [ETAG_PIN]: etag ?? ABSENT }
}

/** The pins of a revision's etag and of its service's etag, `absent` for none. */
export function revisionPins(etag: string | null, serviceEtag: string | null): Record<string, string> {
  return { ...etagPin(etag), [SERVICE_ETAG_PIN]: serviceEtag ?? ABSENT }
}
