import { z } from "zod"
import { unknownOperationError, type OperationTable } from "./operations"
import { chartOperation } from "./operations.charts"
import { filterViewOperation } from "./operations.filter-views"
import { filterOperation } from "./operations.filters"
import { conditionalOperation } from "./operations.rules"
import { pivotOperation } from "./operations.pivots"
import { metadataOperation } from "./operations.metadata"
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
  chart: chartOperation,
  pivot: pivotOperation,
  metadata: metadataOperation,
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
    ADD_OPERATIONS.chart.schema,
    ADD_OPERATIONS.pivot.schema,
    ADD_OPERATIONS.metadata.schema,
  ],
  { error: unknownOperationError(ADD_OPERATION_NAMES) },
)
