import { z } from "zod"
import { defineOperation } from "./operations"
import { MAX_SPREADSHEET_TITLE_LENGTH } from "./schemas"

/** A locale as Google names it: a language, then optional parts after `_` (`ja_JP`, `en_US`). */
const LOCALE_PATTERN = /^[a-z]{2,3}(?:_[A-Za-z0-9]{2,8})*$/

/** The shape of an IANA time zone name (`Asia/Tokyo`, `UTC`, `America/Argentina/Buenos_Aires`). */
const TIME_ZONE_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/

/** Whether the runtime knows the time zone. */
function isTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: name })
    return true
  } catch {
    return false
  }
}

const renameSchema = z.strictObject({
  op: z.literal("spreadsheet_rename"),
  title: z.string().min(1).max(MAX_SPREADSHEET_TITLE_LENGTH).describe("The spreadsheet's new title."),
})

/** `spreadsheet_rename`: gives the spreadsheet a new title. */
export const spreadsheetRenameOperation = defineOperation({
  schema: renameSchema,
  onSpreadsheet: true,
  requests: (op) => [{ updateSpreadsheetProperties: { properties: { title: op.title }, fields: "title" } }],
  tabs: () => [],
  describe: (op) => `spreadsheet_rename ${JSON.stringify(op.title)}`,
})

const settingsSchema = z
  .strictObject({
    op: z.literal("spreadsheet_settings"),
    locale: z
      .string()
      .regex(LOCALE_PATTERN, { error: "must be a locale such as `ja_JP` or `en_US`." })
      .optional()
      .describe("The spreadsheet's locale, such as `ja_JP` or `en_US`: how dates, numbers and currency read."),
    time_zone: z
      .string()
      .regex(TIME_ZONE_PATTERN, { error: "must be an IANA time zone such as `Asia/Tokyo`." })
      .refine(isTimeZone, { error: "must be an IANA time zone such as `Asia/Tokyo`." })
      .optional()
      .describe("The spreadsheet's time zone, an IANA name such as `Asia/Tokyo`: what NOW() and TODAY() read."),
  })
  .refine((op) => op.locale !== undefined || op.time_zone !== undefined, {
    message: "Give `locale` or `time_zone`, or both.",
  })

/** `spreadsheet_settings`: sets the locale and the time zone, which change how dates and numbers read everywhere in the file. */
export const spreadsheetSettingsOperation = defineOperation({
  schema: settingsSchema,
  onSpreadsheet: true,
  requests(op) {
    const properties = {
      ...(op.locale !== undefined && { locale: op.locale }),
      ...(op.time_zone !== undefined && { timeZone: op.time_zone }),
    }
    return [{ updateSpreadsheetProperties: { properties, fields: Object.keys(properties).join(",") } }]
  },
  tabs: () => [],
  describe: (op) =>
    `spreadsheet_settings ${[
      ...(op.locale === undefined ? [] : [`locale ${op.locale}`]),
      ...(op.time_zone === undefined ? [] : [`time zone ${op.time_zone}`]),
    ].join(", ")}`,
})
