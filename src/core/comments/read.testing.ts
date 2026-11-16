import { FILES_URL } from "../drive/read.testing"
import { DRIVE_READ_SCOPE } from "../drive/scopes"
import { CREDENTIAL } from "../google/client.fixtures"
import type { Credential } from "../google/credentials"
import type { FakeHandler } from "../google/fake-google.testing"
import { SHEETS_READ_SCOPE } from "../sheets/scopes"
import { fixture as sheetsFixture } from "../sheets/read.testing"
import { invoke } from "../tool"
import { googleCommentsRead } from "./read"

/** Fixtures the comments read tests share: the state directory and fake Google of the Sheets fixtures, with a label logged in for comments and the comments read as the tool. */

export { answer, callOf, cleanUp, freshTokens } from "../sheets/read.testing"
export { FILE_ID, FOLDER_ID, driveFile, driveFolder, fileUrl, refusal, respond } from "../drive/read.testing"
export { SPREADSHEET_ID, SPREADSHEET_URL } from "../sheets/read.testing"

/** What a label logged in for the comments toolset, read only, holds. */
export const COMMENTS_CREDENTIAL: Credential = {
  ...CREDENTIAL,
  scopes: [...CREDENTIAL.scopes, SHEETS_READ_SCOPE, DRIVE_READ_SCOPE],
}

export const commentsUrl = (fileId: string) => `${FILES_URL}/${fileId}/comments`

/** A made-up Sheets comment thread id and anchor id. */
export const THREAD_ID = "AAAAMadeUpThread"
export const ANCHOR_ID = "anchor-1"

/** A Sheets post as Google gives it, with `extra` laid over it. */
export const post = (id: string, extra: Record<string, unknown> = {}) => ({
  postId: id,
  content: "Please check this figure.",
  author: { displayName: "Ann Example", me: false },
  createTime: "2026-06-01T09:00:00Z",
  updateTime: "2026-06-01T09:30:00Z",
  ...extra,
})

/** A Sheets comment thread with an open head post, with `extra` laid over it. */
export const sheetsThread = (id: string, extra: Record<string, unknown> = {}) => ({
  commentId: id,
  anchorId: ANCHOR_ID,
  status: "OPEN",
  headPost: post(`${id}-head`),
  plainTextQuote: "42",
  ...extra,
})

/** One tab of a spreadsheet reply with the comment anchors on it; an anchor is `[anchorId, range]`. */
export const sheetsTab = (sheetId: number, title: string, anchors: [string, Record<string, number>][] = []) => ({
  properties: { sheetId, title },
  commentAnchors: anchors.map(([anchorId, range]) => ({ anchorId, range: { sheetId, ...range } })),
})

/** The cell B2 of a tab, as Google's grid range writes it. */
export const CELL_B2 = { startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 2 }

/** A Drive comment as `comments.list` gives it, with `extra` laid over it. */
export const driveComment = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  author: { displayName: "Ann Example", me: false },
  content: "Please check this paragraph.",
  createdTime: "2026-06-01T09:00:00.000Z",
  modifiedTime: "2026-06-01T09:30:00.000Z",
  resolved: false,
  deleted: false,
  replies: [],
  ...extra,
})

/** A Drive reply as `comments.list` gives it, with `extra` laid over it. */
export const driveReply = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  author: { displayName: "Bob Example", me: true },
  content: "Done.",
  createdTime: "2026-06-02T09:00:00.000Z",
  modifiedTime: "2026-06-02T09:00:00.000Z",
  deleted: false,
  ...extra,
})

/** The fixtures with a label logged in for comments, and `read` calling the comments read. */
export async function fixture(
  handlers: FakeHandler[] = [],
  credential: Credential | null = COMMENTS_CREDENTIAL,
  env: Record<string, string> = {},
) {
  const h = await sheetsFixture(handlers, credential, env)
  return { ...h, read: (args: unknown) => invoke(googleCommentsRead, args, h.ctx) }
}
