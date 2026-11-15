import { z } from "zod"
import { mergeOperation } from "./operations.merge"
import { unknownOperationError, type OperationTable } from "./operations"
import { deleteOperation, moveOperation } from "./operations.shifting"
import { spreadsheetRenameOperation, spreadsheetSettingsOperation } from "./operations.spreadsheet"
import { tabDeleteOperation, tabRenameOperation } from "./operations.tab-lifecycle"

/** The operations of `google_sheets_restructure`, by the `op` that names each: they remove, move or replace what is there. */
export const RESTRUCTURE_OPERATIONS = {
  delete: deleteOperation,
  move: moveOperation,
  merge: mergeOperation,
  tab_delete: tabDeleteOperation,
  tab_rename: tabRenameOperation,
  spreadsheet_rename: spreadsheetRenameOperation,
  spreadsheet_settings: spreadsheetSettingsOperation,
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
  ],
  { error: unknownOperationError(RESTRUCTURE_OPERATION_NAMES) },
)
