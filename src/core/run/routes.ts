import type { Route } from "../google/routes"
import { RUN_READ_SCOPE, RUN_SCOPE } from "./scopes"

const RUN_HOST = "run.googleapis.com"

/** The path of a project's region; `{region}` fills Google's `locations/` segment. */
const REGION_PATH = "/v2/projects/{project}/locations/{region}"

const SERVICE_PATH = `${REGION_PATH}/services/{service}`
const JOB_PATH = `${REGION_PATH}/jobs/{job}`
const EXECUTION_PATH = `${JOB_PATH}/executions/{execution}`

/** The scopes that read Cloud Run: every read takes the one. */
const READ_SCOPES = [RUN_READ_SCOPE] as const

/** The scope that changes Cloud Run: every write takes the one. */
const WRITE_SCOPES = [RUN_SCOPE] as const

/** The calls the Cloud Run tools may make, each with every scope that allows it, narrowest first. */
export const RUN_ROUTES = {
  services: { method: "GET", host: RUN_HOST, path: `${REGION_PATH}/services`, scopes: READ_SCOPES },
  service: { method: "GET", host: RUN_HOST, path: SERVICE_PATH, scopes: READ_SCOPES },
  /** `services.getIamPolicy`: who may invoke or change the service. */
  serviceIam: { method: "GET", host: RUN_HOST, path: `${SERVICE_PATH}:getIamPolicy`, scopes: READ_SCOPES },
  revisions: { method: "GET", host: RUN_HOST, path: `${SERVICE_PATH}/revisions`, scopes: READ_SCOPES },
  revision: { method: "GET", host: RUN_HOST, path: `${SERVICE_PATH}/revisions/{revision}`, scopes: READ_SCOPES },
  jobs: { method: "GET", host: RUN_HOST, path: `${REGION_PATH}/jobs`, scopes: READ_SCOPES },
  job: { method: "GET", host: RUN_HOST, path: JOB_PATH, scopes: READ_SCOPES },
  /** `jobs.getIamPolicy`: who may run or change the job. */
  jobIam: { method: "GET", host: RUN_HOST, path: `${JOB_PATH}:getIamPolicy`, scopes: READ_SCOPES },
  executions: { method: "GET", host: RUN_HOST, path: `${JOB_PATH}/executions`, scopes: READ_SCOPES },
  execution: { method: "GET", host: RUN_HOST, path: EXECUTION_PATH, scopes: READ_SCOPES },
  tasks: { method: "GET", host: RUN_HOST, path: `${EXECUTION_PATH}/tasks`, scopes: READ_SCOPES },
  /** `operations.get`: one long-running operation, never the list of them or a deletion. */
  operation: { method: "GET", host: RUN_HOST, path: `${REGION_PATH}/operations/{operation}`, scopes: READ_SCOPES },
  /** `services.create`: a new service, with Google's defaults for everything the call leaves out. */
  serviceCreate: { method: "POST", host: RUN_HOST, path: `${REGION_PATH}/services`, scopes: WRITE_SCOPES },
  /** `services.patch`: the parts of a service the update mask names. */
  servicePatch: { method: "PATCH", host: RUN_HOST, path: SERVICE_PATH, scopes: WRITE_SCOPES },
} as const satisfies Record<string, Route>
