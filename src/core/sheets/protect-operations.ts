import { z } from "zod"
import { unknownOperationError, type OperationTable } from "./operations"
import { protectDeleteOperation, protectOperation, protectUpdateOperation } from "./operations.protect"

/** The operations of `google_sheets_protect`, by the `op` that names each: they change who may edit. */
export const PROTECT_OPERATIONS = {
  protect: protectOperation,
  protect_update: protectUpdateOperation,
  protect_delete: protectDeleteOperation,
} as const satisfies OperationTable

/** The names of the operations, as a sentence part. */
export const PROTECT_OPERATION_NAMES = Object.keys(PROTECT_OPERATIONS).join(", ")

/** One operation of a call, told apart by its `op`; an `op` outside the vocabulary is refused, naming it and the ones offered. */
export const protectOperationSchema = z.discriminatedUnion(
  "op",
  [
    PROTECT_OPERATIONS.protect.schema,
    PROTECT_OPERATIONS.protect_update.schema,
    PROTECT_OPERATIONS.protect_delete.schema,
  ],
  { error: unknownOperationError(PROTECT_OPERATION_NAMES) },
)
