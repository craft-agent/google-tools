import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { FOLDER_MIME_TYPE } from "../drive/kinds"
import { DRIVE_FILE_SCOPE } from "../drive/scopes"
import { CREDENTIAL, toolError } from "../google/client.fixtures"
import { SHEETS_READ_SCOPE, SHEETS_WRITE_SCOPE } from "../sheets/scopes"
import {
  ANCHOR_ID,
  BATCH_UPDATE_URL,
  CELL_B2,
  FILE_ID,
  SPREADSHEET_ID,
  THREAD_ID,
  WRITE_CREDENTIAL,
  addFixture,
  answer,
  assignedThread,
  cleanUp,
  commentsUrl,
  driveComment,
  driveFile,
  fileUrl,
  freshTokens,
  postTo,
  saved,
  sheetsHandlers,
  sheetsTab,
  sheetsThread,
} from "./add.testing"
import { COMMENTS_CREDENTIAL } from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

const TABS = [sheetsTab(7, "Plan", [[ANCHOR_ID, CELL_B2]])]

const BATCH = postTo(BATCH_UPDATE_URL, { json: saved() })

/** A spreadsheet fixture: an unassigned thread `THREAD_ID` and an assigned one `assigned`. */
const sheets = () => addFixture([BATCH, ...sheetsHandlers([sheetsThread(THREAD_ID), assignedThread("assigned")], TABS)])

/** A PDF fixture with a comment `c1`. */
const drive = () =>
  addFixture([
    answer(fileUrl(FILE_ID), driveFile(FILE_ID)),
    answer(`${commentsUrl(FILE_ID)}/c1`, driveComment("c1")),
    postTo(commentsUrl(FILE_ID), { json: { id: "c-new" } }),
  ])

type Fixture = Awaited<ReturnType<typeof sheets>>

/** Expects the call to fail with `code` and `message`, and no write to have reached Google. */
async function refuses(h: Fixture, args: unknown, code: string, message = "") {
  await expect(h.add(args)).rejects.toMatchObject({ code, message: expect.stringContaining(message) })
  expect(h.writes()).toEqual([])
}

describe("google_comments_add: a spreadsheet takes a cell or a thread, one cell and one of them", () => {
  test.each([
    ["both", { cell: "Plan!B2", comment_id: THREAD_ID }],
    ["neither", {}],
  ])("%s of `cell` and `comment_id` is invalid_argument, naming both", async (_name, extra) => {
    await refuses(
      await sheets(),
      { file: SPREADSHEET_ID, text: "Hi", ...extra },
      "invalid_argument",
      "exactly one of `cell`",
    )
  })

  test.each([
    ["a range", "Plan!B2:C3"],
    ["a whole column", "Plan!B:B"],
    ["a whole row", "Plan!2:2"],
    ["a tab alone", "Plan"],
    ["a range with an open end", "Plan!B2:C"],
    ["a range of one row", "B2:D2"],
  ])("%s is not one cell", async (_name, cell) => {
    await refuses(await sheets(), { file: SPREADSHEET_ID, cell, text: "Hi" }, "invalid_argument", "one cell")
  })

  test("a tab the spreadsheet lacks is invalid_argument, listing its tabs", async () => {
    await refuses(
      await sheets(),
      { file: SPREADSHEET_ID, cell: "Nowhere!B2", text: "Hi" },
      "invalid_argument",
      "its tabs are: Plan",
    )
  })

  test("a cell that is not A1 notation is invalid_argument", async () => {
    await refuses(await sheets(), { file: SPREADSHEET_ID, cell: "Plan!B0", text: "Hi" }, "invalid_argument", "A1")
  })

  test("a thread the spreadsheet does not have is not_found", async () => {
    await refuses(await sheets(), { file: SPREADSHEET_ID, comment_id: "missing", text: "Hi" }, "not_found")
  })

  test("an assignee on a reply to a thread that has none is refused, and to one that has, is not", async () => {
    const h = await sheets()
    await refuses(
      h,
      { file: SPREADSHEET_ID, comment_id: THREAD_ID, text: "Hi", assignee: "bob@example.test" },
      "invalid_argument",
      "Only a thread that is assigned can be reassigned",
    )
    await h.add({ file: SPREADSHEET_ID, comment_id: "assigned", text: "Hi", assignee: "bob@example.test" })
    expect(h.writes()).toHaveLength(1)
  })

  test("2049 bytes of UTF-8 are refused, stating the count, and 2048 are not", async () => {
    const h = await sheets()
    await refuses(
      h,
      { file: SPREADSHEET_ID, cell: "Plan!B2", text: "あ".repeat(683) },
      "invalid_argument",
      "2049 bytes",
    )
    await h.add({ file: SPREADSHEET_ID, cell: "Plan!B2", text: `${"あ".repeat(682)}ab` })
    expect(h.writes()).toHaveLength(1)
  })
})

describe("google_comments_add: other files", () => {
  test.each([
    ["`cell`", { cell: "B2" }],
    ["`assignee`", { assignee: "bob@example.test" }],
  ])("%s is refused: it applies to a spreadsheet only", async (name, extra) => {
    await refuses(await drive(), { file: FILE_ID, text: "Hi", ...extra }, "invalid_argument", `${name} applies`)
  })

  test("the text is limited in characters, not in bytes, since Google gives no byte limit for them", async () => {
    const h = await drive()
    expect((await h.add({ file: FILE_ID, text: "あ".repeat(683) })).comment_id).toBe("c-new")
  })

  test("a folder is refused, and so is a thread that is not in the format of an id", async () => {
    const folder = await addFixture([answer(fileUrl(FILE_ID), driveFile(FILE_ID, { mimeType: FOLDER_MIME_TYPE }))])
    await refuses(folder, { file: FILE_ID, text: "Hi" }, "invalid_argument", "A folder takes no comments")
    await refuses(await drive(), { file: FILE_ID, comment_id: "../c1", text: "Hi" }, "invalid_argument", "comment id")
  })
})

describe("google_comments_add: the arguments", () => {
  test.each([
    ["no text", { text: "" }],
    ["a text of 2049 characters", { text: "a".repeat(2049) }],
    ["an assignee with a display name", { text: "Hi", cell: "B2", assignee: "Bob <bob@example.test>" }],
    ["an assignee that is no address", { text: "Hi", cell: "B2", assignee: "bob" }],
    ["an argument no call has", { text: "Hi", cell: "B2", resolved: true }],
    ["a file that is no id", { text: "Hi", cell: "B2", file: "a/b" }],
  ])("%s is invalid_argument, and sends nothing", async (_name, extra) => {
    const h = await sheets()
    await expect(h.add({ file: SPREADSHEET_ID, ...extra })).rejects.toMatchObject({ code: "invalid_argument" })
    expect(h.requests).toEqual([])
  })
})

describe("google_comments_add: the label's scopes", () => {
  const args = { file: SPREADSHEET_ID, cell: "Plan!B2", text: "Hi" }

  test("a label that holds only the read scopes fails before any request, with the fix naming comments", async () => {
    const h = await addFixture([BATCH, ...sheetsHandlers([], TABS)], COMMENTS_CREDENTIAL)

    const error = await toolError(h.add(args))

    expect(error).toMatchObject({ code: "unauthenticated" })
    expect(error.message).toContain("comments")
    expect(error.details?.needs).toEqual([SHEETS_WRITE_SCOPE, DRIVE_FILE_SCOPE])
    expect(h.requests).toEqual([])
  })

  test("a label that cannot read the file fails before any request", async () => {
    const credential = { ...CREDENTIAL, scopes: [...CREDENTIAL.scopes, DRIVE_FILE_SCOPE, SHEETS_WRITE_SCOPE] }
    const h = await addFixture([BATCH, ...sheetsHandlers([], TABS)], credential)

    await expect(h.add(args)).rejects.toMatchObject({ code: "unauthenticated" })
    expect(h.requests).toEqual([])
  })

  test("a spreadsheet needs the Sheets write scope even where drive.file is held, and only its file is read first", async () => {
    const credential = { ...COMMENTS_CREDENTIAL, scopes: [...COMMENTS_CREDENTIAL.scopes, DRIVE_FILE_SCOPE] }
    const h = await addFixture([BATCH, ...sheetsHandlers([], TABS)], credential)

    const error = await toolError(h.add(args))

    expect(error).toMatchObject({ code: "unauthenticated" })
    expect(error.details?.needs).toEqual([SHEETS_WRITE_SCOPE])
    expect(h.calls().map((call) => call.url.pathname)).toEqual([`/drive/v3/files/${SPREADSHEET_ID}`])
  })

  test("another file needs drive.file even where the Sheets write scope is held, and a reply needs it too", async () => {
    const credential = { ...COMMENTS_CREDENTIAL, scopes: [...COMMENTS_CREDENTIAL.scopes, SHEETS_WRITE_SCOPE] }
    for (const extra of [{}, { comment_id: "c1" }]) {
      const h = await addFixture(
        [answer(fileUrl(FILE_ID), driveFile(FILE_ID)), answer(`${commentsUrl(FILE_ID)}/c1`, driveComment("c1"))],
        credential,
      )
      const error = await toolError(h.add({ file: FILE_ID, text: "Hi", ...extra }))
      expect(error.details?.needs).toEqual([DRIVE_FILE_SCOPE])
      expect(h.calls()).toHaveLength(1)
    }
  })

  test("a label with the write scopes and without the Sheets read scope still comments on a spreadsheet", async () => {
    const credential = {
      ...WRITE_CREDENTIAL,
      scopes: WRITE_CREDENTIAL.scopes.filter((scope) => scope !== SHEETS_READ_SCOPE),
    }
    const h = await addFixture([BATCH, ...sheetsHandlers([], TABS)], credential)

    await h.add(args)

    expect(h.writes()).toHaveLength(1)
  })
})
