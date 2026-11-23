import { createHash } from "node:crypto"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { wholeCallDescription } from "../describe"
import { toolError } from "../google/client.fixtures"
import { googleRunJobRun } from "./job-run"
import { jobHandler, nightlyJob } from "./jobs.testing"
import { PLACE } from "./read.testing"
import { SECRET_VALUE, cleanUp, container, freshTokens, templateSettings, writeFixture } from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

/** A made-up variable value that a call overrides, which no prompt may hold. */
const SENT_VALUE = "request-made-up-env-value"

const OLD_IMAGE = "asia-northeast1-docker.pkg.dev/my-proj/repo/app:1"

const digest = (lines: string[]) => createHash("sha256").update(lines.join("\n")).digest("hex")

const phrase = (text: string) => ({ text })

async function described(args: Record<string, unknown> = {}, job = nightlyJob()) {
  const h = await writeFixture({ handlers: [jobHandler({ json: job })] })
  return { h, description: await h.jobRun.describe(args) }
}

describe("google_run_job_run describe", () => {
  test("headlines the job from the call's arguments", async () => {
    const { description } = await described()

    expect(description.headline).toEqual({ text: "About to run the job {job}", values: { job: "nightly" } })
  })

  test("shows the image now, the job's tasks, the identity and whether the last run finished", async () => {
    const { description } = await described()

    expect(description.facts).toEqual([
      { label: "Image", value: OLD_IMAGE },
      { label: "Tasks", value: "4" },
      { label: "Runs as", value: "runner@my-proj.iam.gserviceaccount.com" },
      { label: "Last run", value: { text: "{execution} (finished)", values: { execution: "nightly-abc12" } } },
    ])
    expect(description.text).toBeUndefined()
  })

  test("says a task count is for this run only, and that the last run has not finished", async () => {
    const running = nightlyJob({
      latestCreatedExecution: { name: "projects/p/locations/r/jobs/nightly/executions/nightly-run77" },
    })

    const { description } = await described({ task_count: 9 }, running)

    expect(description.facts[1]).toEqual({
      label: "Tasks",
      value: { text: "{count} (this run only)", values: { count: 9 } },
    })
    expect(description.facts[3]).toEqual({
      label: "Last run",
      value: { text: "{execution} (not finished)", values: { execution: "nightly-run77" } },
    })
  })

  test("leaves out the tasks and the last run the job has none of, and names the default service account", async () => {
    const job = nightlyJob({
      latestCreatedExecution: undefined,
      template: { template: templateSettings({ serviceAccount: undefined }) },
    })

    const { description } = await described({}, job)

    expect(description.facts).toEqual([
      { label: "Image", value: OLD_IMAGE },
      { label: "Runs as", value: phrase("the default service account") },
    ])
  })

  test("leaves out the last run when Google returns an empty execution reference", async () => {
    const { description } = await described({}, nightlyJob({ latestCreatedExecution: {} }))

    expect(description.facts.map((fact) => fact.label)).toEqual(["Image", "Tasks", "Runs as"])
  })

  test("leaves out the image when the job has several containers and the call names none", async () => {
    const job = nightlyJob({
      template: { template: templateSettings({ containers: [container(), container({ name: "sidecar" })] }) },
    })

    const { description } = await described({ task_count: 2 }, job)

    expect(description.facts.map((fact) => fact.label)).toEqual(["Tasks", "Runs as", "Last run"])
    expect((await described({ container: "sidecar" }, job)).description.facts[0]!.label).toBe("Image")
  })

  test("lists every override as a line, naming a variable and never showing its value", async () => {
    const { description } = await described({
      env: { MODE: SENT_VALUE, OTHER: "x" },
      args: ["--once", "now"],
      task_count: 2,
      timeout_seconds: 90,
    })

    expect(description.text).toEqual({
      label: "Overrides",
      body: ["env MODE: set", "env OTHER: set", 'args: ["--once","now"]', "tasks: 2", "timeout: 90s"].join("\n"),
    })
    const text = JSON.stringify(description)
    expect(text).not.toContain(SENT_VALUE)
    expect(text).not.toContain(SECRET_VALUE)
  })

  test("says when the arguments are cleared", async () => {
    const { description } = await described({ args: [] })

    expect(description.text?.body).toBe("args: cleared")
  })

  test("is a description the prompt can use: well formed, with the etag and the variables' pin", async () => {
    const h = await writeFixture({ handlers: [jobHandler()] })

    const whole = await wholeCallDescription(googleRunJobRun, { ...PLACE, job: "nightly" }, h.ctx)

    expect(whole?.facts.length).toBeLessThanOrEqual(8)
    expect(whole?.pins).toEqual({ etag: '"job-etag-1"', env: digest(["PLAIN:value", "TOKEN:secret"]) })
  })
})

describe("google_run_job_run pins", () => {
  test("change with the etag and a variable turned into a secret, not with a value", async () => {
    const before = (await described()).description.pins
    expect((await described()).description.pins).toEqual(before)
    expect((await described({}, nightlyJob({ etag: undefined }))).description.pins).toEqual({
      etag: "absent",
      env: before!.env,
    })

    const secret = { valueSource: { secretKeyRef: { secret: "s", version: "1" } } }
    const turned = nightlyJob({
      template: { template: templateSettings({ containers: [container({ env: [{ name: "PLAIN", ...secret }] })] }) },
    })
    expect((await described({}, turned)).description.pins!.env).not.toBe(before!.env)

    const other = nightlyJob({
      template: {
        template: templateSettings({
          containers: [
            container({
              env: [
                { name: "PLAIN", value: "another" },
                { name: "TOKEN", ...secret },
              ],
            }),
          ],
        }),
      },
    })
    expect((await described({}, other)).description.pins!.env).toBe(before!.env)
  })
})

describe("google_run_job_run describe and targets", () => {
  test("describe throws where execute would", async () => {
    const h = await writeFixture({ handlers: [jobHandler()] })

    expect((await toolError(h.jobRun.describe({ env: { TOKEN: "x" } }))).code).toBe("invalid_argument")
    expect((await toolError(h.jobRun.describe({ container: "other" }))).code).toBe("invalid_argument")
  })

  test("the target is the job, under the label, project and region, and a call whose ids are not ids has none", async () => {
    const h = await writeFixture()

    expect(await h.jobRun.targets()).toEqual(["work/projects/my-proj/locations/asia-northeast1/jobs/nightly"])
    expect(h.requests).toEqual([])
    expect(await h.jobRun.targets({ job: "a/b" })).toEqual(["*"])
  })
})
