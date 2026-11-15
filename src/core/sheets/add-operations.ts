import { z } from "zod"
import { unknownOperationError, type OperationTable } from "./operations"
import { insertOperation } from "./operations.shifting"
import { tabDuplicateOperation } from "./operations.tab-lifecycle"

/** The operations of `google_sheets_add`, by the `op` that names each: they add rows, columns and tabs and remove nothing. */
export const ADD_OPERATIONS = {
  insert: insertOperation,
  tab_duplicate: tabDuplicateOperation,
} as const satisfies OperationTable

/** The names of the operations, as a sentence part. */
export const ADD_OPERATION_NAMES = Object.keys(ADD_OPERATIONS).join(", ")

/** One operation of a call, told apart by its `op`; an `op` outside the vocabulary is refused, naming it and the ones offered. */
export const addOperationSchema = z.discriminatedUnion(
  "op",
  [ADD_OPERATIONS.insert.schema, ADD_OPERATIONS.tab_duplicate.schema],
  { error: unknownOperationError(ADD_OPERATION_NAMES) },
)
