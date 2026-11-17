import { createHash } from "node:crypto"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { wholeCallDescription } from "../describe"
import { toolError } from "../google/client.fixtures"
import { googleRunJobDeploy } from "./job-deploy"
import { jobCreateHandler, jobHandler, nightlyJob } from "./jobs.testing"
import { PARENT, PLACE } from "./read.testing"
import {
  OWN_IMAGE,
  SECRET_VALUE,
  cleanUp,
  container,
  freshTokens,
  refusal,
  templateSettings,
  writeFixture,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

/** A made-up variable value that a call sets, which no prompt may hold. */
const SENT_VALUE = "request-made-up-env-value"

const OLD_IMAGE = "asia-northeast1-docker.pkg.dev/my-proj/repo/app:1"

const digest = (lines: string[]) => createHash("sha256").update(lines.join("\n")).digest("hex")

const phrase = (text: string) => ({ text })

async function described(args: Record<string, unknown> = {}, job = nightlyJob()) {
  const h = await writeFixture({ handlers: [jobHandler({ json: job })] })
  return { h, description: await h.jobDeploy.describe(args) }
}

describe("google_run_job_deploy describe: a job that exists", () => {
  test("headlines the image and the job from the call's arguments", async () => {
    const { description } = await described()

    expect(description.headline).toEqual({
      text: "About to deploy {image} to the job {job}",
      values: { image: OWN_IMAGE, job: "nightly" },
    })
  })

  test("shows the image now and what the deploy keeps, and no traffic or ingress", async () => {
    const { description } = await described()

    expect(description.facts).toEqual([
      { label: "Image now", value: OLD_IMAGE },
      { label: "Runs as", value: "runner@my-proj.iam.gserviceaccount.com" },
      { label: "Secret variables", value: { text: "{count} variable", values: { count: 1 } } },
      { label: "Volumes", value: { text: "{count} volumes", values: { count: 4 } } },
      { label: "VPC access", value: `${PARENT}/connectors/vpc` },
    ])
  })

  test("names the default service account and leaves out what the job has none of", async () => {
    const job = nightlyJob({
      template: {
        template: templateSettings({
          serviceAccount: undefined,
          vpcAccess: undefined,
          volumes: [],
          containers: [container({ env: [{ name: "PLAIN", value: SECRET_VALUE }] })],
        }),
      },
    })

    const { description } = await described({}, job)

    expect(description.facts.slice(1)).toEqual([{ label: "Runs as", value: phrase("the default service account") }])
  })

  test("lists every change as a line, the old value and the new, and shows no variable's value", async () => {
    const { description } = await described({
      env: { NEW: SENT_VALUE, PLAIN: null },
      command: ["node", "main.js"],
      args: [],
      cpu: "2",
      memory: "1Gi",
      timeout_seconds: 60,
      task_count: 8,
      parallelism: 4,
      max_retries: 0,
    })

    expect(description.text).toEqual({
      label: "Changes",
      body: [
        `image: ${OLD_IMAGE} → ${OWN_IMAGE}`,
        "env NEW: set",
        "env PLAIN: removed",
        'command: ["node"] → ["node","main.js"]',
        'args: ["server.js"] → []',
        "cpu: 1000m → 2",
        "memory: 512Mi → 1Gi",
        "timeout: 300s → 60s",
        "tasks: 4 → 8",
        "parallelism: 2 → 4",
        "retries: 3 → 0",
      ].join("\n"),
    })
    const text = JSON.stringify(description)
    expect(text).not.toContain(SENT_VALUE)
    expect(text).not.toContain(SECRET_VALUE)
  })

  test("shows - for a setting the job has not set", async () => {
    const job = nightlyJob({
      template: { template: templateSettings({ timeout: undefined, containers: [container({ args: undefined })] }) },
    })

    const { description } = await described({ args: ["a"], timeout_seconds: 5, task_count: 2, max_retries: 1 }, job)

    expect(description.text?.body.split("\n").slice(1)).toEqual([
      'args: - → ["a"]',
      "timeout: - → 5s",
      "tasks: - → 2",
      "retries: - → 1",
    ])
  })

  test("is a description the prompt can use: well formed, with its three pins", async () => {
    const h = await writeFixture({ handlers: [jobHandler()] })

    const whole = await wholeCallDescription(googleRunJobDeploy, { ...PLACE, job: "nightly", image: OWN_IMAGE }, h.ctx)

    expect(whole?.facts.length).toBeLessThanOrEqual(8)
    expect(whole?.pins).toEqual({
      etag: '"job-etag-1"',
      container: "app",
      env: digest(["PLAIN:value", "TOKEN:secret"]),
    })
  })
})

describe("google_run_job_deploy describe: a job to create", () => {
  const MISSING = () => jobHandler(refusal(404, "NOT_FOUND"))

  test("headlines the creation and says what a new job gets, with the change's lines holding no old value", async () => {
    const h = await writeFixture({ handlers: [MISSING(), jobCreateHandler()] })

    const description = await h.jobDeploy.describe({ env: { NEW: SENT_VALUE }, task_count: 3 })

    expect(description.headline).toEqual({
      text: "About to create the job {job} from {image}",
      values: { job: "nightly", image: OWN_IMAGE },
    })
    expect(description.facts).toEqual([{ label: "New job", value: phrase("Google's default service account") }])
    expect(description.text?.body).toBe([`image: ${OWN_IMAGE}`, "env NEW: set", "tasks: 3"].join("\n"))
    expect(JSON.stringify(description)).not.toContain(SENT_VALUE)
  })

  test("pins the etag as absent, the container the call names and the digest of no variables", async () => {
    const h = await writeFixture({ handlers: [MISSING()] })

    expect((await h.jobDeploy.describe({ container: "worker" })).pins).toEqual({
      etag: "absent",
      container: "worker",
      env: digest([]),
    })
  })
})

describe("google_run_job_deploy pins", () => {
  test("change when the etag does, and when a variable has turned into a secret, never with a value", async () => {
    const before = (await described()).description.pins
    expect((await described()).description.pins).toEqual(before)
    expect((await described({}, nightlyJob({ etag: '"job-etag-2"' }))).description.pins).not.toEqual(before)

    const secret = { valueSource: { secretKeyRef: { secret: "s", version: "1" } } }
    const turned = nightlyJob({
      template: {
        template: templateSettings({
          containers: [
            container({
              env: [
                { name: "PLAIN", ...secret },
                { name: "TOKEN", ...secret },
              ],
            }),
          ],
        }),
      },
    })
    const after = (await described({}, turned)).description.pins
    expect(after!.etag).toBe(before!.etag)
    expect(after!.env).not.toBe(before!.env)

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

describe("google_run_job_deploy describe, targets and bounds", () => {
  test("describe throws where execute would", async () => {
    const h = await writeFixture({ handlers: [jobHandler()] })

    expect((await toolError(h.jobDeploy.describe({ env: { TOKEN: "x" } }))).code).toBe("invalid_argument")
  })

  test("the target is the job, under the label, project and region, and a call whose ids are not ids has none", async () => {
    const h = await writeFixture()

    expect(await h.jobDeploy.targets()).toEqual(["work/projects/my-proj/locations/asia-northeast1/jobs/nightly"])
    expect(h.requests).toEqual([])
    expect(await h.jobDeploy.targets({ job: "a/b" })).toEqual(["*"])
  })

  test("measures the image's repository path, and fails for an image outside the project's registry", async () => {
    const h = await writeFixture()

    expect(await h.jobDeploy.measure()).toEqual({ image: "asia-northeast1-docker.pkg.dev/my-proj/apps/api" })
    await expect(h.jobDeploy.measure({ image: "docker.io/library/nginx" })).rejects.toThrow()
  })
})
