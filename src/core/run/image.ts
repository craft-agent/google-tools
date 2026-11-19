import { ToolError } from "../errors"
import type { BoundSpec } from "../tool"
import { shown } from "./ids"

/** An Artifact Registry host: a location, then `-docker.pkg.dev`. */
const ARTIFACT_REGISTRY_HOST = /^[a-z][a-z0-9-]*[a-z0-9]-docker\.pkg\.dev$/

/** The Container Registry hosts. */
const CONTAINER_REGISTRY_HOSTS: readonly string[] = ["gcr.io", "us.gcr.io", "eu.gcr.io", "asia.gcr.io"]

/** A repository or image path segment. */
const SEGMENT_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/

const TAG_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/

/** Whitespace and control characters, which no image holds. */
const UNSAFE_CHARACTER_PATTERN = /[\s\p{Cc}]/u

/** What follows the project in a path: an Artifact Registry's repository and one image segment at least, a Container Registry's one segment. */
const MIN_SEGMENTS_AFTER_PROJECT = { artifactRegistry: 2, containerRegistry: 1 } as const

/** The separator of an image's repository path, which its `prefix` bound splits at. */
const PATH_SEPARATOR = "/"

/** What a grant over a deploy can limit about its image: the repository paths it may deploy from. */
export const imageBound: BoundSpec = {
  kind: "prefix",
  separator: PATH_SEPARATOR,
  description:
    "The image's repository path, without its tag or digest, such as asia-northeast1-docker.pkg.dev/my-proj/apps/api",
}

function notOwnImage(image: string, project: string): ToolError {
  return new ToolError(
    "forbidden",
    `${shown(image)} is not an image of project ${shown(project)}'s own registry. ` +
      "Accepted forms are <location>-docker.pkg.dev/<project>/<repository>/<image>, gcr.io/<project>/<image> and <us|eu|asia>.gcr.io/<project>/<image>, " +
      "each with an optional :<tag> and an optional @sha256:<digest>, and with no port, scheme or whitespace.",
  )
}

/** The path segments, with the tag of the last one split off, or `undefined` when the text holds a second colon. */
function splitTag(path: string): { segments: string[]; tag: string | undefined } | undefined {
  const segments = path.split(PATH_SEPARATOR)
  const last = segments.pop() ?? ""
  const parts = last.split(":")
  if (parts.length > 2) return undefined
  const [name = "", tag] = parts
  return { segments: [...segments, name], tag }
}

/**
 * The repository path of an image of the project's own registry, the form a
 * grant's `image` bound is compared in: the host lowercased and the tag and
 * the digest left off. An image outside the project's own registries (a bare
 * name, Docker Hub, `ghcr.io`, another project's registry) or not written as a
 * plain reference (a port, a scheme, `..`, whitespace) is `forbidden`.
 */
export function imageRepository(image: string, project: string): string {
  const refuse = () => notOwnImage(image, project)
  if (UNSAFE_CHARACTER_PATTERN.test(image) || image.includes("..") || image.includes("://")) throw refuse()

  const [reference = "", digest, ...extra] = image.split("@")
  if (extra.length > 0 || (digest !== undefined && !DIGEST_PATTERN.test(digest))) throw refuse()

  const split = splitTag(reference)
  if (split === undefined || (split.tag !== undefined && !TAG_PATTERN.test(split.tag))) throw refuse()
  const [rawHost = "", owner, ...path] = split.segments
  const host = rawHost.toLowerCase()

  const kind = ARTIFACT_REGISTRY_HOST.test(host)
    ? "artifactRegistry"
    : CONTAINER_REGISTRY_HOSTS.includes(host)
      ? "containerRegistry"
      : undefined
  if (kind === undefined || owner !== project || path.length < MIN_SEGMENTS_AFTER_PROJECT[kind]) throw refuse()
  if (!path.every((segment) => SEGMENT_PATTERN.test(segment))) throw refuse()
  return [host, owner, ...path].join(PATH_SEPARATOR)
}
