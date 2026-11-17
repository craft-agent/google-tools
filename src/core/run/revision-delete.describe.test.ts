import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { wholeCallDescription } from "../describe"
import { toolError } from "../google/client.fixtures"
import { REVISION_IMAGE, oldRevision, revisionHandler } from "./delete.testing"
import { PLACE } from "./read.testing"
import { googleRunRevisionDelete } from "./revision-delete"
import { cleanUp, container, freshTokens, refusal, serviceHandler, apiService, writeFixture } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

async function described(revision = oldRevision(), service = apiService()) {
  const h = await writeFixture({ handlers: [serviceHandler({ json: service }), revisionHandler({ json: revision })] })
  return { h, description: await h.revisionDelete.describe() }
}

describe("google_run_revision_delete describe", () => {
  test("headlines the revision and its service from the call's arguments", async () => {
    const { description } = await described()

    expect(description.headline).toEqual({
      text: "About to delete the revision {revision} of {service}",
      values: { revision: "api-00005-old", service: "api" },
    })
  })

  test("shows when it was created, its image and that it takes no traffic", async () => {
    const { description } = await described()

    expect(description.facts).toEqual([
      { label: "Created", value: "2026-05-01T09:00:00.000Z" },
      { label: "Image", value: REVISION_IMAGE },
      { label: "Traffic", value: { text: "none" } },
    ])
    expect(description.text).toBeUndefined()
  })

  test("leaves out the creation time and the image Google does not give", async () => {
    const { description } = await described(oldRevision({ createTime: undefined, containers: [] }))

    expect(description.facts).toEqual([{ label: "Traffic", value: { text: "none" } }])
  })

  test("shows the first container's image of a revision with several", async () => {
    const { description } = await described(
      oldRevision({ containers: [container({ image: REVISION_IMAGE }), container({ name: "side", image: "x/y:1" })] }),
    )

    expect(description.facts[1]).toEqual({ label: "Image", value: REVISION_IMAGE })
  })

  test("pins the revision's etag and the service's, as absent when there is none", async () => {
    expect((await described()).description.pins).toEqual({ etag: '"rev-etag-1"', service_etag: '"etag-1"' })
    expect((await described(oldRevision({ etag: '"rev-etag-2"' }))).description.pins).toEqual({
      etag: '"rev-etag-2"',
      service_etag: '"etag-1"',
    })
    expect((await described(oldRevision(), apiService({ etag: '"etag-2"' }))).description.pins).toEqual({
      etag: '"rev-etag-1"',
      service_etag: '"etag-2"',
    })
    expect(
      (await described(oldRevision({ etag: undefined }), apiService({ etag: undefined }))).description.pins,
    ).toEqual({ etag: "absent", service_etag: "absent" })
  })

  test("is a description the prompt can use", async () => {
    const h = await writeFixture({ handlers: [serviceHandler(), revisionHandler()] })

    const whole = await wholeCallDescription(
      googleRunRevisionDelete,
      { ...PLACE, service: "api", revision: "api-00005-old" },
      h.ctx,
    )

    expect(whole?.facts).toHaveLength(3)
    expect(whole?.pins).toEqual({ etag: '"rev-etag-1"', service_etag: '"etag-1"' })
  })

  test("throws where execute would: a revision that is gone", async () => {
    const gone = await writeFixture({ handlers: [serviceHandler(), revisionHandler(refusal(404, "NOT_FOUND"))] })

    expect((await toolError(gone.revisionDelete.describe())).code).toBe("not_found")
  })

  test("the target is the revision, under the label, project and region, and a call whose ids are not ids has none", async () => {
    const h = await writeFixture()

    expect(await h.revisionDelete.targets()).toEqual([
      "work/projects/my-proj/locations/asia-northeast1/services/api/revisions/api-00005-old",
    ])
    expect(h.requests).toEqual([])
    expect(await h.revisionDelete.targets({ revision: "a/b" })).toEqual(["*"])
  })
})
