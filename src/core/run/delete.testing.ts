import type { FakeHandler, FakeReply } from "../google/fake-google.testing"
import { JOB_URL } from "./jobs.testing"
import { PARENT, condition, container, respond, templateSettings } from "./read.testing"
import { REVISION, SERVICE, SERVICE_URL, callOf, operation, type WriteFixture } from "./write.testing"

/** Fixtures the Cloud Run deletion tests share: a revision as Google gives it and the handlers that answer the reads and the deletions. */

export const REVISION_URL = `${SERVICE_URL}/revisions/${REVISION}`

/** The image of the revision, an older one than the service's current. */
export const REVISION_IMAGE = "asia-northeast1-docker.pkg.dev/my-proj/apps/api:v1"

/** A revision as `revisions.get` gives it, with an annotation-free template and a made-up etag. */
export const oldRevision = (extra: Record<string, unknown> = {}) => ({
  name: `${PARENT}/services/${SERVICE}/revisions/${REVISION}`,
  etag: '"rev-etag-1"',
  service: `${PARENT}/services/${SERVICE}`,
  generation: "5",
  createTime: "2026-05-01T09:00:00.000Z",
  conditions: [condition("Ready", "CONDITION_SUCCEEDED")],
  ...templateSettings({ containers: [container({ image: REVISION_IMAGE })] }),
  ...extra,
})

/** An operation that is done and holds nothing, as a deletion's is. */
export const deletedOperation = () =>
  operation({ done: true, response: { "@type": "type.googleapis.com/google.protobuf.Empty" } })

/** `GET` of the revision, answering `reply`. */
export const revisionHandler = (reply: FakeReply = { json: oldRevision() }): FakeHandler => respond(REVISION_URL, reply)

/** `DELETE` of `url`, answering `reply`, which is a finished deletion unless given. */
const deleteHandler = (url: string, reply: FakeHandler["reply"] = { json: deletedOperation() }): FakeHandler => ({
  method: "DELETE",
  url,
  reply,
})

/** `DELETE` of the revision, answering `reply`. */
export const revisionDeleteHandler = (reply?: FakeHandler["reply"]): FakeHandler => deleteHandler(REVISION_URL, reply)

/** `DELETE` of the service, answering `reply`. */
export const serviceDeleteHandler = (reply?: FakeHandler["reply"]): FakeHandler => deleteHandler(SERVICE_URL, reply)

/** `DELETE` of the job, answering `reply`. */
export const jobDeleteHandler = (reply?: FakeHandler["reply"]): FakeHandler => deleteHandler(JOB_URL, reply)

/** A wait that never runs out and polls at once, for the deletion tests that follow an operation. */
export const FAST = { waitMs: 60_000, pollMs: 1 }

/** The reply of a deletion that Google has started and not finished. */
export const STARTED = { json: operation() }

/** The calls a fixture saw, each as `METHOD url`. */
export const callsOf = (h: WriteFixture) => h.calls().map(callOf)
