import type { CallFact, CallValue } from "../tool"

/** A fixed phrase of the tool as a fact's value: a template with no values to fill. */
export function phrase(text: string): CallValue {
  return { text }
}

/** A fact that counts something, in the template for one or for many. */
export function countFact(label: string, count: number, one: string, many: string): CallFact {
  return { label, value: { text: count === 1 ? one : many, values: { count } } }
}
