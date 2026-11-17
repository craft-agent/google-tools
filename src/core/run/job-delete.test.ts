import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { wholeCallDescription } from "../describe"
import { toolError } from "../google/client.fixtures"
import { FAST, STARTED, callsOf, deletedOperation, jobDeleteHandler } from "./delete.testing"
import { googleRunJobDelete } from "./job-delete"
import { JOB_URL, jobHandler, nightlyJob } from "./jobs.testing"
import { PLACE, RUN_CREDENTIAL } from "./read.testing"
import {
  OPERATION_ID,
  cleanUp,
  container,
  freshTokens,
  operationHandler,
  operationUrl,
  refusal,
  templateSettings,
  writeFixture,
  type WriteFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const STALE_MESSAGE = "The job changed since it was read; nothing was deleted. Read it again and retry."

const IMAGE = "asia-northeast1-docker.pkg.dev/my-proj/repo/app:1"

async function described(job = nightlyJob()) {
  const h = await writeFixture({ handlers: [jobHandler({ json: job })] })
  return { h, description: await h.jobDelete.describe() }
}

describe("google_run_job_delete", () => {
  test("reads the job, then sends one DELETE with the etag it read as a query", async () => {
    const h = await writeFixture({ handlers: [jobHandler(), jobDeleteHandler()] })

    await h.jobDelete.run()

    expect(callsOf(h)).toEqual([`GET ${JOB_URL}`, `DELETE ${JOB_URL}`])
    expect([...h.writes()[0]!.url.searchParams]).toEqual([["etag", '"job-etag-1"']])
    expect(h.writes()[0]!.json).toBeUndefined()
  })

  test("a job with no etag is deleted without the query", async () => {
    const h = await writeFixture({
      handlers: [jobHandler({ json: nightlyJob({ etag: undefined }) }), jobDeleteHandler()],
    })

    await h.jobDelete.run()

    expect([...h.writes()[0]!.url.searchParams]).toEqual([])
  })

  test("returns the job, whether it is deleted and the operation", async () => {
    const h = await writeFixture({ handlers: [jobHandler(), jobDeleteHandler()] })

    expect(await h.jobDelete.run()).toEqual({
      job: "nightly",
      deleted: true,
      operation: { operation: OPERATION_ID, done: true },
    })
  })

  test("follows the operation until it is done", async () => {
    const h = await writeFixture({
      handlers: [jobHandler(), jobDeleteHandler(STARTED), operationHandler({ json: deletedOperation() })],
    })

    const result = await h.jobDelete.waiting({}, FAST)

    expect(callsOf(h).filter((call) => call === `GET ${operationUrl()}`)).toHaveLength(1)
    expect(result).toMatchObject({ deleted: true })
  })

  test("one still running at the deadline is returned with deleted false", async () => {
    let h!: WriteFixture
    h = await writeFixture({
      handlers: [
        jobHandler(),
        jobDeleteHandler(STARTED),
        operationHandler(() => {
          h.clock.advance(1000)
          return STARTED
        }),
      ],
    })

    const result = await h.jobDelete.waiting({}, { waitMs: 2500, pollMs: 1 })

    expect(result).toEqual({ job: "nightly", deleted: false, operation: { operation: OPERATION_ID, done: false } })
  })

  test.each([
    ["a 409 ABORTED", refusal(409, "ABORTED", "The job was changed.")],
    ["a bare 409", { status: 409, json: { error: { code: 409, message: "Conflict." } } }],
  ])("%s is stale, with nothing deleted", async (_name, reply) => {
    const h = await writeFixture({ handlers: [jobHandler(), jobDeleteHandler(reply)] })

    const error = await toolError(h.jobDelete.run())

    expect(error.code).toBe("stale")
    expect(error.message).toBe(STALE_MESSAGE)
  })

  test("a job that does not exist is not_found, and an id that is not a short name is refused before any request", async () => {
    const gone = await writeFixture({ handlers: [jobHandler(refusal(404, "NOT_FOUND")), jobDeleteHandler()] })
    expect((await toolError(gone.jobDelete.run())).code).toBe("not_found")
    expect(gone.writes()).toEqual([])

    const bad = await writeFixture({ handlers: [jobHandler(), jobDeleteHandler()] })
    expect((await toolError(bad.jobDelete.run({ job: "a/b" }))).code).toBe("invalid_argument")
    expect(bad.requests).toEqual([])
  })

  test("a label that cannot write is told to log in again, before any request", async () => {
    const h = await writeFixture({ handlers: [jobHandler(), jobDeleteHandler()], credential: RUN_CREDENTIAL })

    expect((await toolError(h.jobDelete.run())).code).toBe("unauthenticated")
    expect(h.calls()).toEqual([])
  })

  test("a 403 is forbidden and any other failure keeps its own code", async () => {
    const denied = await writeFixture({
      handlers: [jobHandler(), jobDeleteHandler(refusal(403, "PERMISSION_DENIED"))],
    })
    expect((await toolError(denied.jobDelete.run())).code).toBe("forbidden")

    const failed = await writeFixture({ handlers: [jobHandler(), jobDeleteHandler(refusal(500, "INTERNAL"))] })
    expect((await toolError(failed.jobDelete.run())).code).toBe("upstream_error")
  })
})

describe("google_run_job_delete describe", () => {
  test("headlines the job from the call's arguments", async () => {
    const { description } = await described()

    expect(description.headline).toEqual({
      text: "About to delete the job {job} with its executions",
      values: { job: "nightly" },
    })
  })

  test("shows how many executions go with it, its last run and its image", async () => {
    const { description } = await described()

    expect(description.facts).toEqual([
      { label: "Executions", value: { text: "{count} executions", values: { count: 12 } } },
      { label: "Last run", value: { text: "{execution} (finished)", values: { execution: "nightly-abc12" } } },
      { label: "Image", value: IMAGE },
    ])
    expect(description.text).toBeUndefined()
  })

  test("counts one execution in the singular, and says the last run has not finished", async () => {
    const { description } = await described(
      nightlyJob({
        executionCount: 1,
        latestCreatedExecution: { name: "projects/p/locations/r/jobs/nightly/executions/nightly-run77" },
      }),
    )

    expect(description.facts.slice(0, 2)).toEqual([
      { label: "Executions", value: { text: "{count} execution", values: { count: 1 } } },
      { label: "Last run", value: { text: "{execution} (not finished)", values: { execution: "nightly-run77" } } },
    ])
  })

  test("leaves out the last run a job has none of, and the image when it has several containers", async () => {
    const { description } = await described(
      nightlyJob({
        executionCount: undefined,
        latestCreatedExecution: undefined,
        template: { template: templateSettings({ containers: [container(), container({ name: "sidecar" })] }) },
      }),
    )

    expect(description.facts).toEqual([
      { label: "Executions", value: { text: "{count} executions", values: { count: 0 } } },
    ])
  })

  test("pins the etag, as absent when there is none, and a changed etag changes the pins", async () => {
    expect((await described()).description.pins).toEqual({ etag: '"job-etag-1"' })
    expect((await described(nightlyJob({ etag: '"job-etag-2"' }))).description.pins).toEqual({ etag: '"job-etag-2"' })
    expect((await described(nightlyJob({ etag: undefined }))).description.pins).toEqual({ etag: "absent" })
  })

  test("is a description the prompt can use", async () => {
    const h = await writeFixture({ handlers: [jobHandler()] })

    const whole = await wholeCallDescription(googleRunJobDelete, { ...PLACE, job: "nightly" }, h.ctx)

    expect(whole?.facts).toHaveLength(3)
    expect(whole?.pins).toEqual({ etag: '"job-etag-1"' })
  })

  test("throws where execute would: a job that is gone", async () => {
    const gone = await writeFixture({ handlers: [jobHandler(refusal(404, "NOT_FOUND"))] })

    expect((await toolError(gone.jobDelete.describe())).code).toBe("not_found")
  })

  test("the target is the job, under the label, project and region, and a call whose ids are not ids has none", async () => {
    const h = await writeFixture()

    expect(await h.jobDelete.targets()).toEqual(["work/projects/my-proj/locations/asia-northeast1/jobs/nightly"])
    expect(h.requests).toEqual([])
    expect(await h.jobDelete.targets({ job: "a/b" })).toEqual(["*"])
  })
})
