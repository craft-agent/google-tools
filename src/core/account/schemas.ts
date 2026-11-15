import { z } from "zod"
import type { CredentialSource } from "../google/credentials"

/** The methods of the account read. */
export const ACCOUNT_METHODS = ["list", "check"] as const

export const accountReadInput = z.strictObject({
  method: z.enum(ACCOUNT_METHODS),
  account: z
    .string()
    .optional()
    .describe(
      "check: the account's label. Left out, the only account is checked; with several accounts, the call fails and lists them. list takes none.",
    ),
})

const SOURCES = ["variable", "file"] as const satisfies readonly CredentialSource[]

/** Why a label cannot be used, as the error that says it. */
const problemSchema = z.object({ code: z.string(), message: z.string() })

/** What both methods say first of a label; `source` is as far as it is known. */
const labelHead = {
  account: z.string(),
  source: z.enum(SOURCES).nullable(),
}

/** What both methods say last of a label: its scopes and what they cover, and what a person does about its `problem`. */
const labelTail = {
  scopes: z.array(z.string()),
  toolsets: z.array(z.string()),
  read_only_toolsets: z.array(z.string()),
  problem: problemSchema.nullable(),
  fix: z.string().nullable(),
}

export const listedAccountSchema = z.object({
  ...labelHead,
  variable: z.string(),
  email: z.string().nullable(),
  ...labelTail,
})

export const checkedAccountSchema = z.object({
  ...labelHead,
  ok: z.boolean(),
  email_recorded: z.string().nullable(),
  email_now: z.string().nullable(),
  matches: z.boolean().nullable(),
  ...labelTail,
})

export const accountReadOutput = z.object({
  accounts: z.array(listedAccountSchema).optional(),
  check: checkedAccountSchema.optional(),
})

export type ListedAccount = z.infer<typeof listedAccountSchema>
export type CheckedAccount = z.infer<typeof checkedAccountSchema>
export type AccountProblem = z.infer<typeof problemSchema>
