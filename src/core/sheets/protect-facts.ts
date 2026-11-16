import type { CallFact } from "../tool"
import { editorAddresses, protectionRange, type ProtectionState } from "./protections"
import type { SheetTab } from "./tabs"
import { SHEETS_WORDS } from "./words"
import { operationsFact, tabsFact } from "./write-describe"

/** The `Editors` fact: every editor the protections the call leaves have, in full; `nobody restricted` when it leaves none. */
function editorsFact(left: readonly ProtectionState[]): CallFact {
  const blocking = left.filter((protection) => !protection.warningOnly)
  const names = [...new Map(blocking.flatMap(editorAddresses).map((name) => [name.toLowerCase(), name])).values()]
  const withAccount = blocking.some((protection) => protection.listed)
  const label = SHEETS_WORDS.editors
  if (left.length === 0) return { label, value: { text: SHEETS_WORDS.nobodyRestricted } }
  if (names.length > 0) {
    const editors = names.join(", ")
    return {
      label,
      value: withAccount ? { text: SHEETS_WORDS.accountAndEditors, values: { editors } } : editors,
    }
  }
  if (withAccount) return { label, value: { text: SHEETS_WORDS.accountOnly } }
  return { label, value: { text: blocking.length === 0 ? SHEETS_WORDS.anyoneAfterWarning : SHEETS_WORDS.none } }
}

/** The `Warning only` fact: the ranges of the protections the call leaves that only warn; none where there are none. */
function warningOnlyFacts(left: readonly ProtectionState[], tabs: readonly SheetTab[]): CallFact[] {
  const ranges = left
    .filter((protection) => protection.warningOnly)
    .map((protection) => protectionRange(tabs, protection.range))
  return ranges.length === 0 ? [] : [{ label: SHEETS_WORDS.warningOnly, value: ranges.join(", ") }]
}

/**
 * The facts of a call: who may edit after it (every editor of each protection
 * it leaves, never cut by the tool), the ranges that only warn, the tabs and
 * the operations.
 */
export function protectFacts(
  left: readonly ProtectionState[],
  tabs: readonly SheetTab[],
  written: readonly SheetTab[],
  operations: number,
): CallFact[] {
  return [editorsFact(left), ...warningOnlyFacts(left, tabs), tabsFact(written), operationsFact(operations)]
}
