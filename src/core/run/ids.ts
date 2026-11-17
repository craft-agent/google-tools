import { ToolError } from "../errors"

/** A project id: 6 to 30 lowercase letters, digits and hyphens, starting with a letter and not ending with a hyphen. */
const PROJECT_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/

/** A Cloud Run region such as `asia-northeast1`, `us-central1` or `northamerica-northeast1`. */
const REGION_PATTERN = /^[a-z]+(?:-[a-z]+)+[0-9]+$/

/** The short name of a service, job, revision, execution or task. */
const RESOURCE_NAME_PATTERN = /^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/** The last part of an operation's name. */
const OPERATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

/** How a project's resource name starts, which no project argument takes. */
const PROJECT_PREFIX = "projects/"

/** How much of a refused value an error repeats. */
const MAX_SHOWN_LENGTH = 100

function shown(value: string): string {
  return JSON.stringify(value.length > MAX_SHOWN_LENGTH ? `${value.slice(0, MAX_SHOWN_LENGTH)}…` : value)
}

function refusal(value: string, rule: string): ToolError {
  return new ToolError("invalid_argument", `${shown(value)} ${rule}`)
}

/** `value` when it is a project id, else `invalid_argument`. */
export function projectId(value: string): string {
  if (PROJECT_PATTERN.test(value)) return value
  const hint = value.startsWith(PROJECT_PREFIX) ? "; give the id alone, without `projects/`" : ""
  throw refusal(
    value,
    `is not a project id (6 to 30 lowercase letters, digits and hyphens, starting with a letter)${hint}.`,
  )
}

/** `value` when it is a Cloud Run region such as `asia-northeast1`, else `invalid_argument`. */
export function regionId(value: string): string {
  if (REGION_PATTERN.test(value)) return value
  throw refusal(value, "is not a region such as `asia-northeast1` or `us-central1`.")
}

/** `value` when it is the short name of a `what` (`service name`), else `invalid_argument`; a full resource name is refused. */
export function resourceName(value: string, what: string): string {
  if (RESOURCE_NAME_PATTERN.test(value)) return value
  if (value.includes("/")) {
    throw refusal(value, `is a resource path, not a ${what}; give the short name alone.`)
  }
  throw refusal(
    value,
    `is not a ${what} (1 to 63 lowercase letters, digits and hyphens, starting with a letter and not ending with a hyphen).`,
  )
}

/** `value` when it is an operation id, else `invalid_argument`. */
export function operationId(value: string): string {
  if (OPERATION_PATTERN.test(value)) return value
  throw refusal(value, "is not an operation id.")
}
