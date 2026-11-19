import { z } from "zod"

/** A resource's generation, which Google writes as a string or a number. */
export const generationReply = z.union([z.string(), z.number()]).optional()

/** The instance counts a service template or a revision scales between. */
export const instanceCountsReply = z
  .object({ minInstanceCount: z.number().optional(), maxInstanceCount: z.number().optional() })
  .optional()

/** A generation as text, or `null` when Google gave none. */
export function generationText(generation: string | number | undefined): string | null {
  return generation === undefined ? null : String(generation)
}
