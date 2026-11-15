import { z } from "zod"
import { mergeOperation } from "./operations.merge"
import { unknownOperationError, type OperationTable } from "./operations"
import { chartDeleteOperation, chartMoveOperation, chartUpdateOperation } from "./operations.chart-edits"
import { filterViewDeleteOperation, filterViewUpdateOperation } from "./operations.filter-views"
import { pivotDeleteOperation } from "./operations.pivots"
import { filterClearOperation, filterReplaceOperation } from "./operations.filters"
import { conditionalDeleteOperation, conditionalUpdateOperation } from "./operations.rules"
import { deleteOperation, moveOperation } from "./operations.shifting"
import { spreadsheetRenameOperation, spreadsheetSettingsOperation } from "./operations.spreadsheet"
import { tabDeleteOperation, tabRenameOperation } from "./operations.tab-lifecycle"
import { tableDeleteOperation, tableUpdateOperation } from "./operations.tables"
import { validateClearOperation, validateReplaceOperation } from "./operations.validation"

/** The operations of `google_sheets_restructure`, by the `op` that names each: they remove, move or replace what is there. */
export const RESTRUCTURE_OPERATIONS = {
  delete: deleteOperation,
  move: moveOperation,
  merge: mergeOperation,
  tab_delete: tabDeleteOperation,
  tab_rename: tabRenameOperation,
  spreadsheet_rename: spreadsheetRenameOperation,
  spreadsheet_settings: spreadsheetSettingsOperation,
  table_update: tableUpdateOperation,
  table_delete: tableDeleteOperation,
  conditional_update: conditionalUpdateOperation,
  conditional_delete: conditionalDeleteOperation,
  validate_replace: validateReplaceOperation,
  validate_clear: validateClearOperation,
  filter_replace: filterReplaceOperation,
  filter_clear: filterClearOperation,
  filter_view_update: filterViewUpdateOperation,
  filter_view_delete: filterViewDeleteOperation,
  chart_update: chartUpdateOperation,
  chart_move: chartMoveOperation,
  chart_delete: chartDeleteOperation,
  pivot_delete: pivotDeleteOperation,
} as const satisfies OperationTable

/** The names of the operations, as a sentence part. */
export const RESTRUCTURE_OPERATION_NAMES = Object.keys(RESTRUCTURE_OPERATIONS).join(", ")

/** One operation of a call, told apart by its `op`; an `op` outside the vocabulary is refused, naming it and the ones offered. */
export const restructureOperationSchema = z.discriminatedUnion(
  "op",
  [
    RESTRUCTURE_OPERATIONS.delete.schema,
    RESTRUCTURE_OPERATIONS.move.schema,
    RESTRUCTURE_OPERATIONS.merge.schema,
    RESTRUCTURE_OPERATIONS.tab_delete.schema,
    RESTRUCTURE_OPERATIONS.tab_rename.schema,
    RESTRUCTURE_OPERATIONS.spreadsheet_rename.schema,
    RESTRUCTURE_OPERATIONS.spreadsheet_settings.schema,
    RESTRUCTURE_OPERATIONS.table_update.schema,
    RESTRUCTURE_OPERATIONS.table_delete.schema,
    RESTRUCTURE_OPERATIONS.conditional_update.schema,
    RESTRUCTURE_OPERATIONS.conditional_delete.schema,
    RESTRUCTURE_OPERATIONS.validate_replace.schema,
    RESTRUCTURE_OPERATIONS.validate_clear.schema,
    RESTRUCTURE_OPERATIONS.filter_replace.schema,
    RESTRUCTURE_OPERATIONS.filter_clear.schema,
    RESTRUCTURE_OPERATIONS.filter_view_update.schema,
    RESTRUCTURE_OPERATIONS.filter_view_delete.schema,
    RESTRUCTURE_OPERATIONS.chart_update.schema,
    RESTRUCTURE_OPERATIONS.chart_move.schema,
    RESTRUCTURE_OPERATIONS.chart_delete.schema,
    RESTRUCTURE_OPERATIONS.pivot_delete.schema,
  ],
  { error: unknownOperationError(RESTRUCTURE_OPERATION_NAMES) },
)
