import { z } from "zod"
import { unknownOperationError, type OperationTable } from "./operations"
import { autofillOperation, dedupeOperation, sortOperation, splitTextOperation, trimOperation } from "./operations.data"
import { findReplaceOperation } from "./operations.find-replace"
import { noteOperation, richTextOperation } from "./operations.notes"
import { copyOperation, cutOperation } from "./operations.paste"

/** The operations of `google_sheets_transform`, by the `op` that names each: they rewrite the cells, their notes or their text. */
export const TRANSFORM_OPERATIONS = {
  sort: sortOperation,
  find_replace: findReplaceOperation,
  copy: copyOperation,
  cut: cutOperation,
  dedupe: dedupeOperation,
  trim: trimOperation,
  split_text: splitTextOperation,
  autofill: autofillOperation,
  note: noteOperation,
  rich_text: richTextOperation,
} as const satisfies OperationTable

/** The names of the operations, as a sentence part. */
export const TRANSFORM_OPERATION_NAMES = Object.keys(TRANSFORM_OPERATIONS).join(", ")

/** One operation of a call, told apart by its `op`; an `op` outside the vocabulary is refused, naming it and the ones offered. */
export const transformOperationSchema = z.discriminatedUnion(
  "op",
  [
    TRANSFORM_OPERATIONS.sort.schema,
    TRANSFORM_OPERATIONS.find_replace.schema,
    TRANSFORM_OPERATIONS.copy.schema,
    TRANSFORM_OPERATIONS.cut.schema,
    TRANSFORM_OPERATIONS.dedupe.schema,
    TRANSFORM_OPERATIONS.trim.schema,
    TRANSFORM_OPERATIONS.split_text.schema,
    TRANSFORM_OPERATIONS.autofill.schema,
    TRANSFORM_OPERATIONS.note.schema,
    TRANSFORM_OPERATIONS.rich_text.schema,
  ],
  { error: unknownOperationError(TRANSFORM_OPERATION_NAMES) },
)
