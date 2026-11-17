import type { GoogleClient } from "../google/client"
import type { Place } from "./calls"
import { jobReply, jobView, type JobView } from "./job-view"
import { readResourceState, type ResourceState } from "./resource-state"
import { RUN_ROUTES } from "./routes"

/** A job as a plan reads it (see `ResourceState`). */
export type JobState = ResourceState<JobView>

/** Reads one job for a plan; one that is gone is `not_found`. */
export function readJobState(client: GoogleClient, place: Place, job: string): Promise<JobState> {
  return readResourceState(client, {
    route: RUN_ROUTES.job,
    params: { ...place, job },
    reply: jobReply,
    view: jobView,
    what: "a job",
  })
}
