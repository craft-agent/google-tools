import { changed } from "./change"
import type { OperationOutcome } from "./operation-wait"
import { serviceReply, serviceView, type ServiceView } from "./service-view"

/** The service an operation that is done changed, as the view gives it; `null` while it runs or when its response is not a service. */
export function changedService(outcome: OperationOutcome): ServiceView | null {
  return changed(outcome, serviceReply, serviceView)
}
