import type { Credential } from "../google/credentials"
import type { FakeHandler } from "../google/fake-google.testing"
import { writeTargets } from "../targets"
import { invoke, type ToolContext, type ToolSpec } from "../tool"
import { googleGmailDraftCreate } from "./draft-create"
import { googleGmailDraftDelete } from "./draft-delete"
import { googleGmailDraftEdit } from "./draft-edit"
import { DRAFT_CREDENTIAL } from "./draft.testing"
import { sendFixture } from "./send.testing"

/** The fixture of the draft tools' tests: the send fixtures with a label that may compose, and the three draft tools bound to them. */

/** A draft tool bound to a fixture's context: its call, its prompt, its targets and its bounds. */
function bound(spec: ToolSpec, ctx: ToolContext) {
  return {
    run: (args: unknown) => invoke(spec, args, ctx),
    describe: async (args: unknown) => spec.describe!(spec.input.parse(args), ctx),
    targets: (args: unknown) => writeTargets(spec, args, ctx),
    measure: async (args: unknown) => spec.measure!(spec.input.parse(args), ctx),
  }
}

/**
 * The send fixtures with a label that may compose (unless `credential` says
 * otherwise, `null` for none), an upload directory holding `files`, and the
 * draft tools bound to them.
 */
export async function draftFixture(
  options: {
    handlers?: FakeHandler[]
    credential?: Credential | null
    files?: Record<string, string | Uint8Array>
  } = {},
) {
  const h = await sendFixture({
    handlers: options.handlers ?? [],
    credential: options.credential === undefined ? DRAFT_CREDENTIAL : options.credential,
    files: options.files,
  })
  return {
    ...h,
    create: bound(googleGmailDraftCreate, h.ctx),
    edit: bound(googleGmailDraftEdit, h.ctx),
    delete: bound(googleGmailDraftDelete, h.ctx),
    /** The requests that went to a draft route. */
    draftCalls: () => h.calls().filter((request) => request.url.pathname.includes("/drafts")),
  }
}
