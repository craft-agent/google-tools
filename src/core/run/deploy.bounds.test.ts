import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { matchGrant, measureOf } from "../grant/match"
import type { Grant } from "../grant/model"
import { googleRunServiceDeploy } from "./deploy"
import { cleanUp, freshTokens, writeFixture } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const HOST = "asia-northeast1-docker.pkg.dev"
const GRANTED = `${HOST}/my-proj/apps/api`
const TARGET = "work/projects/my-proj/locations/asia-northeast1/services/api"
const NOW = new Date("2026-06-01T12:00:00Z")
const DIGEST = `sha256:${"a1".repeat(32)}`

const grant = (paths: string[]): Grant => ({
  id: "g1",
  tool: googleRunServiceDeploy.id,
  targets: [TARGET],
  bounds: { image: paths },
  rate: null,
  created_at: "2026-05-31T12:00:00Z",
  expires_at: "2026-06-30T12:00:00Z",
  reason: "deploys of the api",
})

async function covered(image: string, paths: string[] = [GRANTED]): Promise<boolean> {
  const h = await writeFixture()
  const measure = measureOf(googleRunServiceDeploy.bounds!, await h.deploy.measure({ image }))
  return matchGrant({
    call: { tool: googleRunServiceDeploy.id, targets: [TARGET], measure },
    bounds: googleRunServiceDeploy.bounds,
    grants: [grant(paths)],
    now: NOW,
    used: () => 0,
  }).covered
}

describe("google_run_service_deploy measure", () => {
  test.each([
    ["a tag", `${HOST}/my-proj/apps/api:v2`, GRANTED],
    ["a digest", `${HOST}/my-proj/apps/api@${DIGEST}`, GRANTED],
    ["a tag and a digest", `${HOST}/my-proj/apps/api:v2@${DIGEST}`, GRANTED],
    ["a host in capitals", `${HOST.toUpperCase()}/my-proj/apps/api`, GRANTED],
    ["a Container Registry image", "eu.gcr.io/my-proj/team/api:1", "eu.gcr.io/my-proj/team/api"],
  ])("gives the repository path of an image with %s", async (_name, image, repository) => {
    const h = await writeFixture()

    expect(await h.deploy.measure({ image })).toEqual({ image: repository })
  })

  test("fails for an image outside the project's registry, which covers nothing under a grant", async () => {
    const h = await writeFixture()

    await expect(h.deploy.measure({ image: "docker.io/library/nginx" })).rejects.toThrow()
    expect(measureOf(googleRunServiceDeploy.bounds!, undefined)).toBeUndefined()
  })
})

describe("google_run_service_deploy: a grant bounded to an image path", () => {
  test.each([
    ["the image at another tag", `${HOST}/my-proj/apps/api:v2`],
    ["the image by digest", `${HOST}/my-proj/apps/api@${DIGEST}`],
    ["an image under it", `${HOST}/my-proj/apps/api/sub:v1`],
  ])("covers %s", async (_name, image) => {
    expect(await covered(image)).toBe(true)
  })

  test.each([
    ["a repository that only shares its characters", `${HOST}/my-proj/apps/api-old:v2`],
    ["its parent", `${HOST}/my-proj/apps/web`],
    ["the same path on another host", "us-docker.pkg.dev/my-proj/apps/api"],
  ])("does not cover %s", async (_name, image) => {
    expect(await covered(image)).toBe(false)
  })

  test("covers an image under any of several paths", async () => {
    expect(await covered("gcr.io/my-proj/web:1", [GRANTED, "gcr.io/my-proj/web"])).toBe(true)
  })
})
