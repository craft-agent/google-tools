import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { JOB_URL, finishedJob, jobHandler, jobPatchHandler, nightlyJob } from "./jobs.testing"
import { ANNOTATION_VALUE } from "./read.testing"
import {
  OWN_IMAGE,
  SECRET_VALUE,
  callOf,
  cleanUp,
  container,
  freshTokens,
  templateSettings,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

/** A made-up variable value that a call sets and an echoing reply repeats, which no result may hold. */
const SENT_VALUE = "request-made-up-env-value"

type Job = { template: { template: { containers: Record<string, any>[]; [key: string]: any }; [key: string]: any } }

/** The job Google gave with `change` applied: what a deploy must send, the whole job. */
function expectedJob(change: (job: Job) => void, from: Record<string, unknown> = nightlyJob()): Job {
  const job = structuredClone(from) as Job
  change(job)
  return job
}

/** A PATCH that answers with the operation done and the job as the request made it. */
const echoingPatch = () =>
  jobPatchHandler((request) => ({ json: finishedJob(request.json as Record<string, unknown>) }))

async function deployed(args: Record<string, unknown> = {}, job: Record<string, unknown> = nightlyJob()) {
  const h = await writeFixture({ handlers: [jobHandler({ json: job }), echoingPatch()] })
  const result = await h.jobDeploy.run(args)
  const [patch] = h.writes()
  return { h, result, patch: patch!, body: patch!.json as Job & { etag?: string } }
}

describe("google_run_job_deploy: a job that exists", () => {
  test("sends one PATCH of the job with no query, carrying the etag it read", async () => {
    const { h, patch, body } = await deployed()

    expect(h.calls().map(callOf)).toEqual([`GET ${JOB_URL}`, `PATCH ${JOB_URL}`])
    expect([...patch.url.searchParams]).toEqual([])
    expect(body.etag).toBe('"job-etag-1"')
  })

  test("sends back the whole job as Google gave it, with only the image changed", async () => {
    const { body } = await deployed()

    expect(body).toEqual(
      expectedJob((job) => {
        job.template.template.containers[0]!.image = OWN_IMAGE
      }),
    )
    expect(body).toMatchObject({
      labels: { team: "data" },
      annotations: { note: ANNOTATION_VALUE },
      futureField: { nested: [1, 2, 3] },
      template: { labels: { run: "kept" }, template: { futureTaskKey: "kept" } },
    })
    const task = body.template.template
    expect(task.serviceAccount).toBe("runner@my-proj.iam.gserviceaccount.com")
    expect(task.vpcAccess).toEqual(templateSettings().vpcAccess)
    expect(task.volumes).toHaveLength(4)
    expect(task.containers[0]!.env[1]).toEqual({
      name: "TOKEN",
      valueSource: { secretKeyRef: { secret: "api-token", version: "3" } },
    })
  })

  test("changes the settings it is given and keeps the ones it is not", async () => {
    const { body } = await deployed({
      command: ["node", "main.js"],
      args: [],
      cpu: "2",
      timeout_seconds: 60,
      task_count: 8,
      parallelism: 4,
      max_retries: 0,
    })

    expect(body).toEqual(
      expectedJob((job) => {
        const [only] = job.template.template.containers
        Object.assign(only!, { image: OWN_IMAGE, command: ["node", "main.js"], args: [] })
        only!.resources.limits.cpu = "2"
        Object.assign(job.template, { taskCount: 8, parallelism: 4 })
        Object.assign(job.template.template, { timeout: "60s", maxRetries: 0 })
      }),
    )
  })

  test("a task count alone is not checked against the parallelism the job has", async () => {
    const { body } = await deployed({ task_count: 1 })

    expect(body.template).toMatchObject({ taskCount: 1, parallelism: 2 })
  })

  test("sets a variable that is new, replaces one that is there in place and removes another, keeping the secret", async () => {
    const { body } = await deployed({ env: { NEW: SENT_VALUE, PLAIN: "replaced" } })
    expect(body.template.template.containers[0]!.env).toEqual([
      { name: "PLAIN", value: "replaced" },
      { name: "TOKEN", valueSource: { secretKeyRef: { secret: "api-token", version: "3" } } },
      { name: "NEW", value: SENT_VALUE },
    ])

    const removed = await deployed({ env: { PLAIN: null } })
    expect(removed.body.template.template.containers[0]!.env).toEqual([
      { name: "TOKEN", valueSource: { secretKeyRef: { secret: "api-token", version: "3" } } },
    ])
  })

  test("changes only the container it names among several", async () => {
    const job = nightlyJob({
      template: {
        taskCount: 4,
        template: templateSettings({
          containers: [container(), container({ name: "sidecar", image: "gcr.io/my-proj/side:1" })],
        }),
      },
    })
    const { body } = await deployed({ container: "sidecar", memory: "1Gi" }, job)

    const [app, sidecar] = body.template.template.containers
    expect(app).toEqual(container())
    expect(sidecar).toMatchObject({ name: "sidecar", image: OWN_IMAGE })
    expect(sidecar!.resources.limits.memory).toBe("1Gi")
  })

  test("returns what it was before and the job as it is now, with no environment value from the reply or the call", async () => {
    const { result } = await deployed({ env: { NEW: SENT_VALUE } })

    expect(result).toMatchObject({
      created: false,
      before: {
        image: "asia-northeast1-docker.pkg.dev/my-proj/repo/app:1",
        template: {
          max_retries: 3,
          service_account: "runner@my-proj.iam.gserviceaccount.com",
          containers: [
            {
              env: [
                { name: "PLAIN", kind: "value" },
                { name: "TOKEN", kind: "secret", secret: "api-token", version: "3" },
              ],
            },
          ],
        },
      },
      job: { job: "nightly", task_count: 4 },
      operation: { operation: "op-1", done: true },
    })
    const text = JSON.stringify(result)
    expect(text).not.toContain(SENT_VALUE)
    expect(text).not.toContain(SECRET_VALUE)
    expect(text).not.toContain(ANNOTATION_VALUE)
  })

  test("a job with no etag is updated without one", async () => {
    const { body } = await deployed({}, nightlyJob({ etag: undefined }))

    expect(body).not.toHaveProperty("etag")
  })
})
