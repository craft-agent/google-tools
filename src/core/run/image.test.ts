import { describe, expect, test } from "bun:test"
import { imageRepository } from "./image"

const PROJECT = "my-proj"
const DIGEST = `sha256:${"a1".repeat(32)}`

describe("imageRepository: the forms accepted", () => {
  test.each([
    [
      "an Artifact Registry image",
      "asia-northeast1-docker.pkg.dev/my-proj/apps/api",
      "asia-northeast1-docker.pkg.dev/my-proj/apps/api",
    ],
    [
      "with a tag",
      "asia-northeast1-docker.pkg.dev/my-proj/apps/api:v2",
      "asia-northeast1-docker.pkg.dev/my-proj/apps/api",
    ],
    ["with a digest", `us-docker.pkg.dev/my-proj/apps/api@${DIGEST}`, "us-docker.pkg.dev/my-proj/apps/api"],
    [
      "with a tag and a digest",
      `us-docker.pkg.dev/my-proj/apps/api:v1@${DIGEST}`,
      "us-docker.pkg.dev/my-proj/apps/api",
    ],
    [
      "in a deeper path",
      "us-docker.pkg.dev/my-proj/apps/team/api.v2:1.0",
      "us-docker.pkg.dev/my-proj/apps/team/api.v2",
    ],
    ["with a host in capitals", "US-Docker.Pkg.Dev/my-proj/apps/api:v2", "us-docker.pkg.dev/my-proj/apps/api"],
    ["a Container Registry image", "gcr.io/my-proj/api:latest", "gcr.io/my-proj/api"],
    ["a regional Container Registry image", "eu.gcr.io/my-proj/team/api", "eu.gcr.io/my-proj/team/api"],
    ["an asia.gcr.io image with a digest", `asia.gcr.io/my-proj/api@${DIGEST}`, "asia.gcr.io/my-proj/api"],
    ["a us.gcr.io image", "us.gcr.io/my-proj/api:v1", "us.gcr.io/my-proj/api"],
  ])("%s gives its repository path", (_name, image, repository) => {
    expect(imageRepository(image, PROJECT)).toBe(repository)
  })
})

describe("imageRepository: the forms refused", () => {
  test.each([
    ["a bare name", "nginx"],
    ["a bare name with a tag", "nginx:latest"],
    ["Docker Hub", "docker.io/library/nginx:latest"],
    ["Docker Hub with a user", "someone/app:1"],
    ["ghcr.io", "ghcr.io/my-proj/app:1"],
    ["another project's registry", "us-docker.pkg.dev/other-proj/apps/api:v2"],
    ["another project's gcr.io", "gcr.io/other-proj/api"],
    ["a project that only starts with the call's", "gcr.io/my-proj-2/api"],
    ["a port", "asia-northeast1-docker.pkg.dev:443/my-proj/apps/api"],
    ["a port on gcr.io", "gcr.io:443/my-proj/api"],
    ["a scheme", "https://gcr.io/my-proj/api"],
    ["a dot-dot segment", "gcr.io/my-proj/../other/api"],
    ["a dot-dot inside a name", "gcr.io/my-proj/a..b"],
    ["whitespace", "gcr.io/my-proj/api v2"],
    ["a newline", "gcr.io/my-proj/api\n"],
    ["a control character", "gcr.io/my-proj/api\u0007"],
    ["an Artifact Registry path with no image", "us-docker.pkg.dev/my-proj/apps"],
    ["a registry path with no image", "gcr.io/my-proj"],
    ["a registry with no project", "gcr.io"],
    ["an empty segment", "gcr.io/my-proj//api"],
    ["a trailing slash", "gcr.io/my-proj/api/"],
    ["a name in capitals", "gcr.io/my-proj/API"],
    ["a tag in the middle of the path", "gcr.io/my-proj/api:v1/sub"],
    ["a second tag", "gcr.io/my-proj/api:v1:v2"],
    ["a tag that starts with a dot", "gcr.io/my-proj/api:.v1"],
    ["a tag that is too long", `gcr.io/my-proj/api:${"a".repeat(129)}`],
    ["a short digest", "gcr.io/my-proj/api@sha256:abc"],
    ["a digest of another algorithm", `gcr.io/my-proj/api@sha512:${"a".repeat(64)}`],
    ["a digest in capitals", `gcr.io/my-proj/api@sha256:${"A".repeat(64)}`],
    ["two digests", `gcr.io/my-proj/api@${DIGEST}@${DIGEST}`],
    ["a lookalike host", "gcr.io.evil.test/my-proj/api"],
    ["a docker.pkg.dev host with no location", "-docker.pkg.dev/my-proj/apps/api"],
    ["an empty string", ""],
  ])("refuses %s as forbidden", (_name, image) => {
    expect(() => imageRepository(image, PROJECT)).toThrow(
      expect.objectContaining({ name: "ToolError", code: "forbidden" }),
    )
  })

  test("the message names the image, clipped and quoted, and the forms accepted", () => {
    const long = `docker.io/${"x".repeat(200)}`
    let message = ""
    try {
      imageRepository(long, PROJECT)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain(JSON.stringify(`${long.slice(0, 100)}…`))
    expect(message).not.toContain("x".repeat(101))
    expect(message).toContain("docker.pkg.dev")
    expect(message).toContain("gcr.io")
    expect(message).toContain('"my-proj"')
  })
})
