/** The short name a resource name ends in (`api` of `projects/p/locations/r/services/api`), or `null` when there is no name. */
export function shortNameOrNull(name: string | undefined): string | null {
  if (name === undefined || name === "") return null
  return name.slice(name.lastIndexOf("/") + 1)
}

/** The short name a resource name ends in, or an empty string when there is no name. */
export function shortName(name: string | undefined): string {
  return shortNameOrNull(name) ?? ""
}
