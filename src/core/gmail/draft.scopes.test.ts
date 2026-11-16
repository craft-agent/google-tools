import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { toolError } from "../google/client.fixtures"
import type { Credential } from "../google/credentials"
import {
  DRAFT_CREDENTIAL,
  DRAFT_ID,
  cleanUp,
  createHandler,
  deleteHandler,
  draftHandler,
  draftMetadata,
  freshTokens,
  removeUploads,
  updateHandler,
} from "./draft.testing"
import { draftFixture } from "./draft.fixture.testing"
import { GMAIL_COMPOSE_SCOPE, GMAIL_MODIFY_SCOPE } from "./scopes"
import { SEND_CREDENTIAL } from "./send.testing"

beforeEach(freshTokens)
afterEach(async () => {
  await cleanUp()
  await removeUploads()
})

const mail = { to: ["ann@example.test"], subject: "Lunch", body: "Are we still on?" }

/** What each draft write is called with, and the requests that would answer it. */
const WRITES = [
  ["create", mail, [createHandler]],
  ["edit", { ...mail, draft_id: DRAFT_ID }, [draftHandler(draftMetadata()), updateHandler]],
  ["delete", { draft_id: DRAFT_ID }, [draftHandler(draftMetadata()), deleteHandler]],
] as const

/** A label that reads and composes, with its compose scope replaced by `scope`, or dropped when `scope` is `null`. */
const holding = (scope: string | null): Credential => ({
  ...DRAFT_CREDENTIAL,
  scopes: [...DRAFT_CREDENTIAL.scopes.filter((held) => held !== GMAIL_COMPOSE_SCOPE), ...(scope ? [scope] : [])],
})

describe("the draft writes check the label's scopes before any request", () => {
  const WITHOUT = [
    ["only the send scope", SEND_CREDENTIAL],
    ["neither the compose nor the modify scope", holding(null)],
  ] as const

  describe.each(WRITES)("%s", (name, args, handlers) => {
    test.each(WITHOUT)(
      "a label holding %s fails as unauthenticated, naming the login that adds the scope",
      async (_what, credential) => {
        const h = await draftFixture({ handlers: [...handlers], credential })
        const error = await toolError(h[name].run(args))
        expect(error.code).toBe("unauthenticated")
        expect(error.message).toContain("login")
        expect(h.requests).toEqual([])
      },
    )

    test.each(WITHOUT)("and its prompt cannot be drawn for a label holding %s", async (_what, credential) => {
      const h = await draftFixture({ handlers: [...handlers], credential })
      expect((await toolError(h[name].describe(args))).code).toBe("unauthenticated")
      expect(h.requests).toEqual([])
    })

    test.each([GMAIL_COMPOSE_SCOPE, GMAIL_MODIFY_SCOPE])(
      "a label holding the %s scope may make the call",
      async (scope) => {
        const h = await draftFixture({ handlers: [...handlers], credential: holding(scope) })
        await h[name].run(args)
        expect(h.draftCalls().length).toBeGreaterThan(0)
      },
    )
  })
})
