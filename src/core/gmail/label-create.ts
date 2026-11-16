import { z } from "zod"
import { ToolError } from "../errors"
import { abortError } from "../exec"
import type { GoogleClient } from "../google/client"
import { googleSession } from "../google/session"
import { parseReply } from "../sheets/reply"
import { defineTool, type CallDescription, type ToolContext } from "../tool"
import {
  MAX_LABEL_NAME_LENGTH,
  gmailLabelCreateInput,
  gmailLabelCreateOutput,
  type GmailLabelCreateArgs,
} from "./label-args"
import { labelColors, type LabelColors } from "./label-colors"
import { LABELS_WORK } from "./label-plan"
import { readLabels } from "./labels"
import { GMAIL_ROUTES } from "./routes"
import { GMAIL_TOOLSET } from "./scopes"
import { GMAIL_WORDS } from "./words"

/** What stands in for the id of a label that does not exist yet, in the call's target. */
const NEW_LABEL = "new"

/** What `labels.create` answers. */
const createdReply = z.object({ id: z.string(), name: z.string().optional() })

/** A label to create, checked: the colors it takes and the client that makes it. */
type LabelCreatePlan = { client: GoogleClient; colors: LabelColors | undefined }

/**
 * Checks the colors, the label's scopes and that no label of the mailbox, a
 * system one included, already has the name, ignoring case. Any failure here
 * fails the call before anything is written.
 */
async function planLabelCreate(args: GmailLabelCreateArgs, ctx: ToolContext): Promise<LabelCreatePlan> {
  const colors = labelColors(args)
  if (ctx.signal?.aborted) throw abortError(ctx.signal)
  const { client } = await googleSession(ctx, args.account, LABELS_WORK, GMAIL_TOOLSET)
  await client.requireScopes(GMAIL_ROUTES.labelCreate)
  const taken = (await readLabels(client)).labels.find((label) => label.name.toLowerCase() === args.name.toLowerCase())
  if (taken) {
    throw new ToolError(
      "invalid_argument",
      `A label named ${JSON.stringify(taken.name)} (${taken.label_id}) already exists, and names are compared ignoring case; use it by name or id, or choose another name.`,
    )
  }
  return { client, colors }
}

/** The headline names the label, and a `Colors` fact says the colors when the call gives them. */
function describeLabelCreate(args: GmailLabelCreateArgs, { colors }: LabelCreatePlan): CallDescription {
  return {
    headline: { text: GMAIL_WORDS.labelCreate, values: { name: args.name } },
    facts:
      colors === undefined
        ? []
        : [
            {
              label: GMAIL_WORDS.colors,
              value: {
                text: GMAIL_WORDS.colorsValue,
                values: { text: colors.textColor, background: colors.backgroundColor },
              },
            },
          ],
  }
}

/** The body of `labels.create`: the name, the colors and the two visibilities that were given. */
function labelBody(args: GmailLabelCreateArgs, colors: LabelColors | undefined) {
  return {
    name: args.name,
    ...(colors && { color: colors }),
    ...(args.show_in_list !== undefined && { labelListVisibility: args.show_in_list ? "labelShow" : "labelHide" }),
    ...(args.show_in_messages !== undefined && { messageListVisibility: args.show_in_messages ? "show" : "hide" }),
  }
}

export const googleGmailLabelCreate = defineTool({
  id: "google_gmail_label_create",
  title: "Create Gmail label",
  intent: "About to create a label",
  description:
    `Create a label in the account's Gmail, named \`name\` (1 to ${MAX_LABEL_NAME_LENGTH} characters, no space at either end; \`/\` nests it under another label, as Gmail does: \`Work/Invoices\`). A name already used by a label, ignoring case, is refused. ` +
    "`text_color` and `background_color` set its colors, both or neither, each a `#rrggbb` from Gmail's fixed palette (a refusal lists it); `show_in_list` and `show_in_messages` say whether it shows in the label list and on messages. " +
    "Each call makes a new label; put it on mail with `google_gmail_label`. Returns the new `label_id` and its `name`. " +
    "`account` is needed when several accounts are set up.",
  toolset: GMAIL_TOOLSET,
  class: "add",
  input: gmailLabelCreateInput,
  output: gmailLabelCreateOutput,
  async targets(args, ctx) {
    const { label } = await googleSession(ctx, args.account, LABELS_WORK, GMAIL_TOOLSET)
    return [`${label}/labels/${NEW_LABEL}`]
  },
  async describe(args, ctx) {
    return describeLabelCreate(args, await planLabelCreate(args, ctx))
  },
  async execute(args, ctx) {
    const { client, colors } = await planLabelCreate(args, ctx)
    const reply = parseReply(
      createdReply,
      await client.request(GMAIL_ROUTES.labelCreate, { body: labelBody(args, colors) }),
      "the new label",
    )
    return { label_id: reply.id, name: reply.name ?? args.name }
  },
})
