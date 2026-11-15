import { z } from "zod"
import { isRecord } from "../describe"
import { bordersOperation, formatOperation, unmergeOperation } from "./operations.cells"
import {
  groupOperation,
  hideOperation,
  sizeOperation,
  unhideOperation,
  ungroupOperation,
} from "./operations.dimensions"
import type { OperationTable } from "./operations"
import { freezeOperation, tabOperation } from "./operations.tabs"

/** The operations of `google_sheets_format`, by the `op` that names each: formatting that changes no value and removes nothing. */
export const FORMAT_OPERATIONS = {
  format: formatOperation,
  borders: bordersOperation,
  size: sizeOperation,
  hide: hideOperation,
  unhide: unhideOperation,
  group: groupOperation,
  ungroup: ungroupOperation,
  unmerge: unmergeOperation,
  freeze: freezeOperation,
  tab: tabOperation,
} as const satisfies OperationTable

/** The names of the operations, as a sentence part. */
export const FORMAT_OPERATION_NAMES = Object.keys(FORMAT_OPERATIONS).join(", ")

/** One operation of a call, told apart by its `op`; an `op` outside the vocabulary is refused, naming it and the ones offered. */
export const formatOperationSchema = z.discriminatedUnion(
  "op",
  [
    FORMAT_OPERATIONS.format.schema,
    FORMAT_OPERATIONS.borders.schema,
    FORMAT_OPERATIONS.size.schema,
    FORMAT_OPERATIONS.hide.schema,
    FORMAT_OPERATIONS.unhide.schema,
    FORMAT_OPERATIONS.group.schema,
    FORMAT_OPERATIONS.ungroup.schema,
    FORMAT_OPERATIONS.unmerge.schema,
    FORMAT_OPERATIONS.freeze.schema,
    FORMAT_OPERATIONS.tab.schema,
  ],
  {
    error: (issue) => {
      if (issue.code !== "invalid_union") return undefined
      const op = isRecord(issue.input) ? issue.input.op : undefined
      const named = typeof op === "string" ? ` ${JSON.stringify(op.length > 40 ? `${op.slice(0, 40)}…` : op)}` : ""
      return `Unknown operation${named}; the operations are: ${FORMAT_OPERATION_NAMES}.`
    },
  },
)
