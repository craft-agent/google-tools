import { z } from "zod"
import { rangeText } from "./operation-ranges"

/** The most addresses one editor list of a call holds. */
export const MAX_EDITORS = 10

const MAX_EMAIL_LENGTH = 100
const MAX_LABEL_LENGTH = 200
const MAX_EXCEPTED_RANGES = 50

const EMAIL = /^[^@\s,;<>"']{1,64}@[^@\s,;<>"']+\.[^@\s,;<>"']{2,}$/

const emailArg = z
  .string()
  .trim()
  .toLowerCase()
  .max(MAX_EMAIL_LENGTH)
  .regex(EMAIL, "An editor is an email address, such as `name@example.com`.")

/** Up to `MAX_EDITORS` addresses; a repeated address counts once. */
export const editorList = z.array(emailArg).max(MAX_EDITORS)

/** The addresses, each once, in the order given. */
export function distinctEditors(addresses: readonly string[]): string[] {
  return [...new Set(addresses)]
}

/** The protection a `protect_update` or `protect_delete` names: its id, or its label. */
export const protectionKey = z
  .union([z.string().min(1).max(MAX_LABEL_LENGTH), z.number().int()])
  .describe("The protection's id, or its label (as the `structure` read lists them).")

/** What `protect` and `protect_update` both set besides the range. */
export const protectionFields = {
  except: z
    .array(rangeText)
    .max(MAX_EXCEPTED_RANGES)
    .optional()
    .describe(
      "Cell ranges on the protected tab that stay editable by anyone, for a protection of a whole tab (`range` is the tab's title); an empty list removes the exceptions.",
    ),
  label: z
    .string()
    .trim()
    .max(MAX_LABEL_LENGTH)
    .optional()
    .describe(
      "The protection's label, by which `protect_update` and `protect_delete` can name it; an empty text removes it.",
    ),
  warning_only: z
    .boolean()
    .optional()
    .describe(
      "`true` lets anyone who can edit the file edit after a warning, and takes no editors; `false` (the default of a new protection) lets only the editors and you edit.",
    ),
}

type Editing = { warning_only?: boolean; editors?: string[]; add_editors?: string[]; remove_editors?: string[] }

/** The schema, which also refuses editors on a warning-only protection, which has none. */
export function warningWithoutEditors<S extends z.ZodType<Editing>>(schema: S): S {
  return schema.refine(
    ({ warning_only, editors, add_editors, remove_editors }) =>
      warning_only !== true || (editors === undefined && add_editors === undefined && remove_editors === undefined),
    { message: "A warning-only protection has no editors: anyone who can edit the file may edit after the warning." },
  )
}
