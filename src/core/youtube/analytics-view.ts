import { z } from "zod"

/** What a report says of the data it holds. */
export const ANALYTICS_NOTE =
  "YouTube Analytics leaves out the most recent two to three days until their data is final; averageViewDuration is in seconds and estimatedMinutesWatched in minutes."

/** The name of the column that holds a video's id. */
export const VIDEO_COLUMN = "video"

const cellReply = z.union([z.string(), z.number()])

/** A report as `reports.query` gives it; every field not read here is left out of the parse. */
export const analyticsReply = z.object({
  columnHeaders: z.array(z.object({ name: z.string() })).optional(),
  rows: z.array(z.array(cellReply)).optional(),
})

/** One row of a report: a value for each column, as Google gives it. */
export const analyticsRowSchema = z.array(cellReply)

export type AnalyticsRow = z.output<typeof analyticsRowSchema>
