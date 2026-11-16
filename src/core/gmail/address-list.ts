import { EMAIL_PATTERN } from "../email"

/** The address between the angle brackets that end an item of an address list, as in `Ann <ann@example.test>`; a name with brackets of its own is not read. */
const ANGLE_ADDRESS = /^[^<>]*<([^<>]*)>$/

/**
 * The items of an address header, as `Ann <ann@example.test>, bob@example.test`
 * holds them: split at the commas that are not inside a quoted name or angle
 * brackets, comments in parentheses dropped, white space (a fold included)
 * as one space, empty items left out.
 */
export function splitAddressList(header: string): string[] {
  const items: string[] = []
  let current = ""
  let quoted = false
  let angled = false
  let commentDepth = 0
  for (let at = 0; at < header.length; at++) {
    const character = header[at]!
    if (commentDepth > 0) {
      if (character === "\\") at++
      else if (character === "(") commentDepth++
      else if (character === ")") commentDepth--
    } else if (quoted) {
      current += character
      if (character === "\\" && at + 1 < header.length) current += header[++at]!
      else if (character === '"') quoted = false
    } else if (character === '"') {
      quoted = true
      current += character
    } else if (character === "(") {
      commentDepth = 1
    } else if (character === "," && !angled) {
      items.push(current)
      current = ""
    } else {
      if (character === "<") angled = true
      if (character === ">") angled = false
      current += character
    }
  }
  items.push(current)
  return items.map((item) => item.replace(/\s+/g, " ").trim()).filter((item) => item !== "")
}

/** The plain address of one item of an address list (`Ann <ann@example.test>`, `<ann@example.test>` or `ann@example.test`), or `undefined` when it holds none, such as a group. */
export function addressOf(item: string): string | undefined {
  const candidate = ANGLE_ADDRESS.exec(item)?.[1]?.trim() ?? item
  return EMAIL_PATTERN.test(candidate) ? candidate : undefined
}
