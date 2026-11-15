import { z } from "zod"
import { unknownOperationError, type OperationTable } from "./operations"
import { filterViewOperation } from "./operations.filter-views"
import { filterOperation } from "./operations.filters"
import { conditionalOperation } from "./operations.rules"
import { insertOperation } from "./operations.shifting"
import { tabDuplicateOperation } from "./operations.tab-lifecycle"
import { tableOperation } from "./operations.tables"
import { validateOperation } from "./operations.validation"

/** The operations of `google_sheets_add`, by the `op` that names each: they add rows, columns, tabs and objects and remove nothing. */
export const ADD_OPERATIONS = {
  insert: insertOperation,
  tab_duplicate: tabDuplicateOperation,
  table: tableOperation,
  conditional: conditionalOperation,
  validate: validateOperation,
  filter: filterOperation,
  filter_view: filterViewOperation,
} as const satisfies OperationTable

/** The names of the operations, as a sentence part. */
export const ADD_OPERATION_NAMES = Object.keys(ADD_OPERATIONS).join(", ")

/** One operation of a call, told apart by its `op`; an `op` outside the vocabulary is refused, naming it and the ones offered. */
export const addOperationSchema = z.discriminatedUnion(
  "op",
  [
    ADD_OPERATIONS.insert.schema,
    ADD_OPERATIONS.tab_duplicate.schema,
    ADD_OPERATIONS.table.schema,
    ADD_OPERATIONS.conditional.schema,
    ADD_OPERATIONS.validate.schema,
    ADD_OPERATIONS.filter.schema,
    ADD_OPERATIONS.filter_view.schema,
  ],
  { error: unknownOperationError(ADD_OPERATION_NAMES) },
)
