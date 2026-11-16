import { SPREADSHEET_MIME_TYPE } from "../drive/kinds"
import { DRIVE_FILE_SCOPE } from "../drive/scopes"
import type { Credential } from "../google/credentials"
import type { FakeHandler } from "../google/fake-google.testing"
import { SHEETS_WRITE_SCOPE } from "../sheets/scopes"
import { writeTargets } from "../targets"
import { invoke } from "../tool"
import { googleCommentsAdd } from "./add"
import {
  COMMENTS_CREDENTIAL,
  SPREADSHEET_ID,
  SPREADSHEET_URL,
  answer,
  driveFile,
  fileUrl,
  fixture,
  post,
  sheetsTab,
  sheetsThread,
} from "./read.testing"

/** Fixtures the comment write tests share: the comments read fixtures with a label that may read and write, and the add tool bound to them. */

export {
  ANCHOR_ID,
  CELL_B2,
  FILE_ID,
  SPREADSHEET_ID,
  SPREADSHEET_URL,
  THREAD_ID,
  answer,
  callOf,
  cleanUp,
  commentsUrl,
  driveComment,
  driveFile,
  fileUrl,
  freshTokens,
  post,
  refusal,
  respond,
  sheetsTab,
  sheetsThread,
} from "./read.testing"

/** What a label logged in for the comments toolset, reading and writing, holds. */
export const WRITE_CREDENTIAL: Credential = {
  ...COMMENTS_CREDENTIAL,
  scopes: [...COMMENTS_CREDENTIAL.scopes, SHEETS_WRITE_SCOPE, DRIVE_FILE_SCOPE],
}

export const BATCH_UPDATE_URL = `${SPREADSHEET_URL}:batchUpdate`

/** The file read of the spreadsheet, and its spreadsheet read, which gives the tabs and the threads of one reply. */
export const sheetsHandlers = (comments: unknown[] = [], sheets: unknown[] = [sheetsTab(0, "Plan")]): FakeHandler[] => [
  answer(fileUrl(SPREADSHEET_ID), driveFile(SPREADSHEET_ID, { name: "Budget 2026", mimeType: SPREADSHEET_MIME_TYPE })),
  answer(SPREADSHEET_URL, { properties: { title: "Budget 2026" }, comments, sheets }),
]

/** A POST handler for `url` that answers `reply`. */
export const postTo = (url: string, reply: FakeHandler["reply"]): FakeHandler => ({ method: "POST", url, reply })

/** What `batchUpdate` answers when it saved the comment, with `extra` laid over it. */
export const saved = (extra: Record<string, unknown> = {}) => ({ commentUpdateState: "ALL_SAVED", ...extra })

/** A spreadsheet thread with an assigned head post, which a reply may reassign. */
export const assignedThread = (id: string, extra: Record<string, unknown> = {}) =>
  sheetsThread(id, { headPost: post(`${id}-head`, { assigneeEmail: "ann@example.test" }), ...extra })

/** The fixtures with a label that may read and write comments (unless given otherwise), and the add tool bound to them. */
export async function addFixture(handlers: FakeHandler[] = [], credential: Credential | null = WRITE_CREDENTIAL) {
  const h = await fixture(handlers, credential)
  return {
    ...h,
    add: (args: unknown) => invoke(googleCommentsAdd, args, h.ctx),
    describe: async (args: unknown) => googleCommentsAdd.describe!(googleCommentsAdd.input.parse(args), h.ctx),
    targets: (args: unknown) => writeTargets(googleCommentsAdd, args, h.ctx),
    /** The requests that changed something. */
    writes: () => h.calls().filter((request) => request.method !== "GET"),
  }
}
