import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { DRIVE_FILE_SCOPE } from "../drive/scopes"
import { CREDENTIAL, toolError } from "../google/client.fixtures"
import { SHEETS_WRITE_SCOPE } from "../sheets/scopes"
import { invoke } from "../tool"
import { COMMENTS_CREDENTIAL } from "./read.testing"
import {
  ANCHOR_ID,
  BATCH_UPDATE_URL,
  CELL_B2,
  CHANGES,
  FILE_ID,
  ME,
  SPREADSHEET_ID,
  THREAD_ID,
  answer,
  changeFixture,
  cleanUp,
  commentsUrl,
  driveComment,
  driveFile,
  fileUrl,
  freshTokens,
  post,
  postTo,
  saved,
  sheetsHandlers,
  sheetsTab,
  sheetsThread,
} from "./write.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const TABS = [sheetsTab(7, "Plan", [[ANCHOR_ID, CELL_B2]])]

const COMMENT_URL = `${commentsUrl(FILE_ID)}/c1`

const SHEETS_HANDLERS = [
  postTo(BATCH_UPDATE_URL, { json: saved() }),
  ...sheetsHandlers([sheetsThread(THREAD_ID, { headPost: post("h", { author: ME }) })], TABS),
]

const DRIVE_HANDLERS = [
  answer(fileUrl(FILE_ID), driveFile(FILE_ID)),
  answer(COMMENT_URL, driveComment("c1", { author: ME })),
]

describe("the label's scopes, for every tool that changes a thread", () => {
  describe.each(CHANGES)("%s", (_id, tool, extra) => {
    const spreadsheet = { file: SPREADSHEET_ID, comment_id: THREAD_ID, ...extra }

    test("a label that holds only the read scopes fails before any request, with the fix naming comments", async () => {
      const h = await changeFixture(SHEETS_HANDLERS, COMMENTS_CREDENTIAL)

      const error = await toolError(invoke(tool, spreadsheet, h.ctx))

      expect(error).toMatchObject({ code: "unauthenticated" })
      expect(error.message).toContain("comments")
      expect(error.details?.needs).toEqual([SHEETS_WRITE_SCOPE, DRIVE_FILE_SCOPE])
      expect(h.requests).toEqual([])
    })

    test("a label that cannot read the file fails before any request", async () => {
      const credential = { ...CREDENTIAL, scopes: [...CREDENTIAL.scopes, DRIVE_FILE_SCOPE, SHEETS_WRITE_SCOPE] }
      const h = await changeFixture(SHEETS_HANDLERS, credential)

      await expect(invoke(tool, spreadsheet, h.ctx)).rejects.toMatchObject({ code: "unauthenticated" })
      expect(h.requests).toEqual([])
    })

    test("a spreadsheet needs the Sheets write scope even where drive.file is held, and only its file is read first", async () => {
      const credential = { ...COMMENTS_CREDENTIAL, scopes: [...COMMENTS_CREDENTIAL.scopes, DRIVE_FILE_SCOPE] }
      const h = await changeFixture(SHEETS_HANDLERS, credential)

      const error = await toolError(invoke(tool, spreadsheet, h.ctx))

      expect(error.details?.needs).toEqual([SHEETS_WRITE_SCOPE])
      expect(h.calls().map((call) => call.url.pathname)).toEqual([`/drive/v3/files/${SPREADSHEET_ID}`])
    })

    test("another file needs drive.file even where the Sheets write scope is held, and only its file is read first", async () => {
      const credential = { ...COMMENTS_CREDENTIAL, scopes: [...COMMENTS_CREDENTIAL.scopes, SHEETS_WRITE_SCOPE] }
      const h = await changeFixture(DRIVE_HANDLERS, credential)

      const error = await toolError(invoke(tool, { file: FILE_ID, comment_id: "c1", ...extra }, h.ctx))

      expect(error.details?.needs).toEqual([DRIVE_FILE_SCOPE])
      expect(h.calls()).toHaveLength(1)
    })

    test("a label with the write scopes and without the Sheets read scope still changes a spreadsheet's thread", async () => {
      const h = await changeFixture(SHEETS_HANDLERS, {
        ...CREDENTIAL,
        scopes: [...COMMENTS_CREDENTIAL.scopes, SHEETS_WRITE_SCOPE, DRIVE_FILE_SCOPE],
      })

      await invoke(tool, spreadsheet, h.ctx)

      expect(h.writes()).toHaveLength(1)
    })

    test("a file that is not an id, a comment id that is a path and a reply id that is a path are invalid_argument, and send nothing", async () => {
      const h = await changeFixture(SHEETS_HANDLERS)

      for (const args of [
        { ...spreadsheet, file: "a/b" },
        { ...spreadsheet, comment_id: "../c1" },
        { ...spreadsheet, reply_id: "../p1" },
      ]) {
        await expect(invoke(tool, args, h.ctx)).rejects.toMatchObject({ code: "invalid_argument" })
      }
      expect(h.requests).toEqual([])
    })
  })
})
