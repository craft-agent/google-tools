import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { DRIVES_URL, SHARED_DRIVE_ID, answer, cleanUp, fixture, freshTokens } from "./read.testing"

beforeEach(freshTokens)
afterEach(cleanUp)

describe("google_drive_read drives", () => {
  test("lists the shared drives, with the paging field", async () => {
    const h = await fixture([
      answer(DRIVES_URL, {
        drives: [
          { id: SHARED_DRIVE_ID, name: "Design", createdTime: "2025-01-02T03:04:05.000Z" },
          { id: "0AOtherDrive", name: "Finance" },
        ],
        nextPageToken: "next-1",
      }),
    ])

    expect(await h.read({ method: "drives" })).toEqual({
      drives: [
        { drive_id: SHARED_DRIVE_ID, name: "Design", created_time: "2025-01-02T03:04:05.000Z" },
        { drive_id: "0AOtherDrive", name: "Finance" },
      ],
      next_page_token: "next-1",
    })
  })

  test("an account with no shared drive has none and no next page", async () => {
    const h = await fixture([answer(DRIVES_URL, {})])

    expect(await h.read({ method: "drives" })).toEqual({ drives: [], next_page_token: null })
  })

  test("asks for 50 at a time and sends no query unless one is given", async () => {
    const h = await fixture([answer(DRIVES_URL, {})])

    await h.read({ method: "drives" })

    const query = Object.fromEntries(h.calls()[0]!.url.searchParams)
    expect(query).toMatchObject({ pageSize: "50", fields: "nextPageToken,drives(id,name,createdTime)" })
    expect(query.q).toBeUndefined()
    expect(query.pageToken).toBeUndefined()
  })

  test("sends the query, the limit and the page token", async () => {
    const h = await fixture([answer(DRIVES_URL, {})])

    await h.read({ method: "drives", query: "name contains 'Design'", limit: 5, page_token: "tok-2" })

    expect(Object.fromEntries(h.calls()[0]!.url.searchParams)).toMatchObject({
      q: "name contains 'Design'",
      pageSize: "5",
      pageToken: "tok-2",
    })
  })
})
