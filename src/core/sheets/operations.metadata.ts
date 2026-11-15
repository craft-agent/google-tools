import { z } from "zod"
import { cut } from "../describe"
import { ToolError } from "../errors"
import { quoteTab } from "./a1"
import { dimensionOf, resolveRange } from "./grid"
import {
  googleVisibility,
  locationBody,
  metadataIdArg,
  metadataKeyArg,
  metadataValueArg,
  metadataVisibilityArg,
  placeOf,
  type DeveloperMetadata,
  type MetadataLocation,
} from "./metadata"
import { rangeText } from "./operation-ranges"
import { defineOperation, type OperationContext } from "./operations"
import { tabNamed, tabTitle } from "./operations.tabs"
import { shownRange, type SheetTab } from "./tabs"

/** How many characters of a value a line shows. */
const SHOWN_VALUE_LENGTH = 40

/** What a row or a column is called in a message about the one a range may span. */
const DIMENSION_NOUNS = { rows: "row", columns: "column" } as const

const onArg = z
  .union([z.literal("spreadsheet"), z.strictObject({ tab: tabTitle }), z.strictObject({ range: rangeText })], {
    error:
      'Give `on` as "spreadsheet", `{ tab }` or `{ range }` of one whole row or whole column (`Plan!5:5`, `Plan!C:C`).',
  })
  .describe(
    'Where the metadata sits: "spreadsheet", `{ tab }` (the tab\'s title), or `{ range }` of one whole row (`Plan!5:5`) or one whole column (`Plan!C:C`); a row or column keeps its metadata when it is sorted or moved.',
  )

const keyArg = metadataKeyArg.describe("The metadata's key, 1 to 100 characters; several entries may share one.")

const valueArg = metadataValueArg.describe("The metadata's value, up to 2000 characters; empty means none.")

const visibilityArg = metadataVisibilityArg.describe(
  "`document` (the default): anyone with the file can read it; `project`: only the Cloud project that made it can.",
)

type On = z.output<typeof onArg>

/**
 * Where `on` puts the metadata: the spreadsheet, a tab, or one whole row or
 * column. A range that is any other block, or both rows and columns, or that
 * spans more than the one row or column Google attaches metadata to, is
 * `invalid_argument`.
 */
function locate(on: On, tabs: readonly SheetTab[]): MetadataLocation {
  if (on === "spreadsheet") return { kind: "spreadsheet" }
  if ("tab" in on) return { kind: "tab", sheetId: tabNamed(tabs, on.tab).sheetId }
  const { grid } = resolveRange(tabs, on.range)
  const { sheetId, dimension, startIndex, endIndex } = dimensionOf(grid, on.range)
  const kind = dimension === "ROWS" ? "rows" : "columns"
  if (endIndex - startIndex !== 1) {
    throw new ToolError(
      "invalid_argument",
      `${JSON.stringify(shownRange(on.range))} spans ${endIndex - startIndex} ${kind}; Google attaches metadata to exactly one ${DIMENSION_NOUNS[kind]}, so give one (\`Plan!5:5\`, \`Plan!C:C\`) and add one operation for each.`,
    )
  }
  return { kind, sheetId, startIndex, endIndex }
}

/** The tabs the locations lie on, each once; a location on a tab the call no longer has is `invalid_argument`. */
function tabsOf(locations: readonly MetadataLocation[], context: OperationContext): SheetTab[] {
  const tabs = locations.flatMap((location) => {
    if (location.kind === "spreadsheet") return []
    const tab = context.tabs.find((candidate) => candidate.sheetId === location.sheetId)
    if (tab === undefined) {
      throw new ToolError(
        "invalid_argument",
        "The metadata lies on a tab that an earlier operation of the call deletes.",
      )
    }
    return [tab]
  })
  return [...new Map(tabs.map((tab) => [tab.sheetId, tab])).values()]
}

/** Whether the location is the spreadsheet itself. */
const onSpreadsheet = (...locations: readonly MetadataLocation[]) =>
  locations.some((location) => location.kind === "spreadsheet")

/** Where the metadata sits as a line says it. */
function locationWords(location: MetadataLocation, tabs: readonly SheetTab[]): string {
  const { kind, tab, range } = placeOf(location, tabs)
  if (kind === "spreadsheet") return "the spreadsheet"
  return kind === "tab" ? `tab ${quoteTab(tab ?? "")}` : `${kind} ${range}`
}

/** The key, and the value when it has one, as a line quotes them. */
function entryWords(key: string, value: string | undefined): string {
  return `${JSON.stringify(key)}${value === undefined ? "" : `=${JSON.stringify(cut(value, SHOWN_VALUE_LENGTH))}`}`
}

/** The visibility as a line says it, only where it is not the default. */
function visibilityWords(visibility: DeveloperMetadata["visibility"]): string {
  return visibility === "project" ? " (project only)" : ""
}

/** The metadata with the id among the metadata the call read; an id it does not show is `invalid_argument`. */
function findMetadata(context: OperationContext, metadataId: number): DeveloperMetadata {
  const found = context.metadata.find((entry) => entry.metadataId === metadataId)
  if (found === undefined) {
    throw new ToolError(
      "invalid_argument",
      `No developer metadata with id ${metadataId} is visible to this account on the spreadsheet; google_sheets_read's \`metadata\` method lists the ids.`,
    )
  }
  return found
}

/** The filter that selects the one piece of metadata by its id. */
const byId = (metadataId: number) => ({ developerMetadataLookup: { metadataId } })

const addSchema = z.strictObject({
  op: z.literal("metadata"),
  key: keyArg,
  value: valueArg.optional(),
  visibility: visibilityArg.optional(),
  on: onArg,
})

/** `metadata`: attaches a key, and a value, to the spreadsheet, a tab, or one row or column. */
export const metadataOperation = defineOperation({
  schema: addSchema,
  changesSpreadsheet: (op, { tabs }) => onSpreadsheet(locate(op.on, tabs)),
  requests(op, { tabs }) {
    return [
      {
        createDeveloperMetadata: {
          developerMetadata: {
            metadataKey: op.key,
            ...(op.value !== undefined && op.value !== "" && { metadataValue: op.value }),
            location: locationBody(locate(op.on, tabs)),
            visibility: googleVisibility(op.visibility ?? "document"),
          },
        },
      },
    ]
  },
  tabs: (op, context) => tabsOf([locate(op.on, context.tabs)], context),
  describe(op, { tabs }) {
    const value = op.value === "" ? undefined : op.value
    return `metadata ${entryWords(op.key, value)}${visibilityWords(op.visibility ?? "document")} on ${locationWords(locate(op.on, tabs), tabs)}`
  },
})

const updateSchema = z
  .strictObject({
    op: z.literal("metadata_update"),
    metadata_id: metadataIdArg.describe("The id `google_sheets_read`'s `metadata` method lists."),
    key: keyArg.optional(),
    value: valueArg.optional().describe("The new value, up to 2000 characters; empty removes it."),
    visibility: visibilityArg.optional(),
    on: onArg.optional(),
  })
  .refine((op) => [op.key, op.value, op.visibility, op.on].some((part) => part !== undefined), {
    message: "Give `key`, `value`, `visibility` or `on` to change.",
  })

/** What `metadata_update` works out before it changes anything: the metadata as it is, and as it will be. */
function planUpdate(op: z.output<typeof updateSchema>, context: OperationContext) {
  const current = findMetadata(context, op.metadata_id)
  const after: DeveloperMetadata = {
    ...current,
    key: op.key ?? current.key,
    value: op.value === undefined ? current.value : op.value === "" ? undefined : op.value,
    visibility: op.visibility ?? current.visibility,
    location: op.on === undefined ? current.location : locate(op.on, context.tabs),
  }
  return { current, after }
}

/** `metadata_update`: changes the key, value, visibility or place of a piece of metadata; what is not given stays as it is. */
export const metadataUpdateOperation = defineOperation({
  schema: updateSchema,
  needs: ["metadata"],
  changesSpreadsheet(op, context) {
    const { current, after } = planUpdate(op, context)
    return onSpreadsheet(current.location, after.location)
  },
  requests(op, context) {
    const { current, after } = planUpdate(op, context)
    const sets = {
      metadataKey: op.key !== undefined,
      metadataValue: op.value !== undefined,
      visibility: op.visibility !== undefined,
      location: op.on !== undefined,
    }
    Object.assign(current, after)
    return [
      {
        updateDeveloperMetadata: {
          dataFilters: [byId(op.metadata_id)],
          developerMetadata: {
            ...(sets.metadataKey && { metadataKey: after.key }),
            ...(sets.metadataValue && after.value !== undefined && { metadataValue: after.value }),
            ...(sets.visibility && { visibility: googleVisibility(after.visibility) }),
            ...(sets.location && { location: locationBody(after.location) }),
          },
          fields: Object.entries(sets)
            .filter(([, set]) => set)
            .map(([field]) => field)
            .join(","),
        },
      },
    ]
  },
  tabs(op, context) {
    const { current, after } = planUpdate(op, context)
    return tabsOf([current.location, after.location], context)
  },
  describe(op, context) {
    const { current, after } = planUpdate(op, context)
    const changes = [
      ...(op.key === undefined ? [] : [`key to ${JSON.stringify(after.key)}`]),
      ...(op.value === undefined
        ? []
        : [
            after.value === undefined ? "no value" : `value to ${JSON.stringify(cut(after.value, SHOWN_VALUE_LENGTH))}`,
          ]),
      ...(op.visibility === undefined ? [] : [`visibility to ${after.visibility}`]),
      ...(op.on === undefined ? [] : [`moved to ${locationWords(after.location, context.tabs)}`]),
    ]
    return `metadata_update #${current.metadataId} ${entryWords(current.key, current.value)}${visibilityWords(current.visibility)} on ${locationWords(current.location, context.tabs)}: ${changes.join(", ")}`
  },
  pins: (op, context) => [findMetadata(context, op.metadata_id).definition],
})

const deleteSchema = z.strictObject({
  op: z.literal("metadata_delete"),
  metadata_id: metadataIdArg.describe("The id `google_sheets_read`'s `metadata` method lists."),
})

/** `metadata_delete`: removes a piece of metadata from where it sits; the cells it marked stay. */
export const metadataDeleteOperation = defineOperation({
  schema: deleteSchema,
  needs: ["metadata"],
  changesSpreadsheet: (op, context) => onSpreadsheet(findMetadata(context, op.metadata_id).location),
  requests(op, context) {
    const current = findMetadata(context, op.metadata_id)
    context.metadata = context.metadata.filter((entry) => entry !== current)
    return [{ deleteDeveloperMetadata: { dataFilter: byId(op.metadata_id) } }]
  },
  tabs: (op, context) => tabsOf([findMetadata(context, op.metadata_id).location], context),
  describe(op, context) {
    const current = findMetadata(context, op.metadata_id)
    return `metadata_delete #${current.metadataId} ${entryWords(current.key, current.value)}${visibilityWords(current.visibility)} on ${locationWords(current.location, context.tabs)}; the cells it marked stay`
  },
  pins: (op, context) => [findMetadata(context, op.metadata_id).definition],
})
