import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import { revisionDeleteHandler, revisionHandler } from "./delete.testing"
import { LATEST_ALLOCATION, REVISION_ALLOCATION } from "./service-view"
import {
  PARENT,
  REVISION,
  SERVICE,
  apiService,
  cleanUp,
  followsLatest,
  freshTokens,
  serviceHandler,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const OTHER = "api-00007-abc"

/** The name of the revision under test as the service names its latest ready revision. */
const LATEST_READY = `${PARENT}/services/${SERVICE}/revisions/${REVISION}`

/** A target that sends `percent` of the traffic to the revision under test, with a tag when given. */
const toRevision = (percent: number, tag?: string) => ({
  type: REVISION_ALLOCATION,
  revision: REVISION,
  percent,
  ...(tag === undefined ? {} : { tag }),
})

/** A target that sends all the traffic to another revision. */
const toOther = () => ({ type: REVISION_ALLOCATION, revision: OTHER, percent: 100 })

/** A service whose traffic, as set and as served, is given. */
const serving = (traffic: unknown[], trafficStatuses: unknown[], extra: Record<string, unknown> = {}) =>
  apiService({ traffic, trafficStatuses, ...extra })

const fixtureFor = (service: Record<string, unknown>) =>
  writeFixture({ handlers: [serviceHandler({ json: service }), revisionHandler(), revisionDeleteHandler()] })

const refusedAs = (reason: string) =>
  `"${REVISION}" still serves "${SERVICE}" (${reason}); move the traffic with google_run_traffic_set first. Nothing was deleted.`

describe("google_run_revision_delete refusals", () => {
  test.each([
    ["a share of the traffic as set", serving([toRevision(100)], []), "100% of its traffic"],
    ["a share of the traffic as served", serving([toOther()], [toRevision(30), toOther()]), "30% of its traffic"],
    ["a tag as set", serving([toOther(), toRevision(0, "old")], []), "the tag old"],
    ["a tag as served", serving([toOther()], [toOther(), toRevision(0, "old")]), "the tag old"],
    [
      "being the latest ready revision while the traffic follows the latest",
      apiService({ latestReadyRevision: LATEST_READY, ...followsLatest() }),
      "the latest revision's traffic",
    ],
  ])("%s is refused as invalid_argument, and nothing is sent", async (_name, service, reason) => {
    const h = await fixtureFor(service)

    const error = await toolError(h.revisionDelete.run())

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe(refusedAs(reason))
    expect(h.writes()).toEqual([])
  })

  test("describe refuses the same way", async () => {
    const h = await fixtureFor(serving([toRevision(100)], []))

    expect((await toolError(h.revisionDelete.describe())).message).toBe(refusedAs("100% of its traffic"))
  })

  test("a revision that is not the latest is deleted while the traffic follows the latest", async () => {
    const h = await fixtureFor(apiService())

    expect(await h.revisionDelete.run()).toMatchObject({ deleted: true })
    expect(h.writes()).toHaveLength(1)
  })

  test("the latest ready revision is deleted when the traffic goes to another revision", async () => {
    const h = await fixtureFor(serving([toOther()], [toOther()], { latestReadyRevision: LATEST_READY }))

    expect(await h.revisionDelete.run()).toMatchObject({ deleted: true })
    expect(h.writes()).toHaveLength(1)
  })

  test("the latest ready revision is deleted when its latest entry takes no share", async () => {
    const idle = { type: LATEST_ALLOCATION, percent: 0 }
    const h = await fixtureFor(serving([toOther(), idle], [toOther()], { latestReadyRevision: LATEST_READY }))

    expect(await h.revisionDelete.run()).toMatchObject({ deleted: true })
  })
})
