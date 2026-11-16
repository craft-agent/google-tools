import { writeTargets } from "../targets"
import { invoke, type ToolSpec } from "../tool"
import { googleCommentsDelete } from "./delete"
import { googleCommentsEdit } from "./edit"
import { googleCommentsStatus } from "./status"
import { WRITE_CREDENTIAL } from "./add.testing"
import { fixture } from "./read.testing"
import type { Credential } from "../google/credentials"
import type { FakeHandler } from "../google/fake-google.testing"

/** Fixtures the tests of the tools that change a thread share: the add fixtures' label that may read and write, and the three tools bound to it. */

export { BATCH_UPDATE_URL, WRITE_CREDENTIAL, postTo, saved, sheetsHandlers } from "./add.testing"
export {
  ANCHOR_ID,
  CELL_B2,
  FILE_ID,
  SPREADSHEET_ID,
  THREAD_ID,
  answer,
  callOf,
  cleanUp,
  commentsUrl,
  driveComment,
  driveFile,
  driveReply,
  fileUrl,
  freshTokens,
  post,
  refusal,
  respond,
  sheetsTab,
  sheetsThread,
} from "./read.testing"

/** The author of a post the account wrote, and of one another person wrote. */
export const ME = { displayName: "Me Example", me: true }
export const OTHER = { displayName: "Ann Example", me: false }

/** A DELETE handler for `url` that answers `reply`. */
export const deleteTo = (url: string, reply: FakeHandler["reply"]): FakeHandler => ({ method: "DELETE", url, reply })

/** A PATCH handler for `url` that answers `reply`. */
export const patchTo = (url: string, reply: FakeHandler["reply"]): FakeHandler => ({ method: "PATCH", url, reply })

/** The tools that change a thread, each with the arguments beyond `file` and `comment_id` that make a valid call. */
export const CHANGES: ReadonlyArray<readonly [string, ToolSpec, Record<string, unknown>]> = [
  ["google_comments_status", googleCommentsStatus, { status: "resolved" }],
  ["google_comments_edit", googleCommentsEdit, { text: "New words." }],
  ["google_comments_delete", googleCommentsDelete, {}],
]

/** The fixtures with a label that may read and write comments (unless given otherwise), and the three tools bound to them. */
export async function changeFixture(handlers: FakeHandler[] = [], credential: Credential | null = WRITE_CREDENTIAL) {
  const h = await fixture(handlers, credential)
  return {
    ...h,
    status: (args: unknown) => invoke(googleCommentsStatus, args, h.ctx),
    edit: (args: unknown) => invoke(googleCommentsEdit, args, h.ctx),
    remove: (args: unknown) => invoke(googleCommentsDelete, args, h.ctx),
    describe: async (tool: Pick<ToolSpec, "input" | "describe">, args: unknown) =>
      tool.describe!(tool.input.parse(args), h.ctx),
    targets: (tool: Pick<ToolSpec, "input" | "targets">, args: unknown) => writeTargets(tool, args, h.ctx),
    /** The requests that changed something. */
    writes: () => h.calls().filter((request) => request.method !== "GET"),
  }
}
