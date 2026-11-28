import { Buffer } from "node:buffer"
import { ToolError } from "../errors"
import { shown } from "../run/ids"

/** The most characters of a video's title. */
export const MAX_TITLE_CHARACTERS = 100

/** The most bytes, in UTF-8, of a video's description. */
export const MAX_DESCRIPTION_BYTES = 5000

/** The most characters of a video's tags in all, as Google counts them. */
export const MAX_TAG_CHARACTERS = 500

/** What Google adds to the count of a tag that holds a space, for the quotes it writes around it. */
const QUOTED_TAG_EXTRA = 2

/** A category id: up to three digits. */
const CATEGORY_PATTERN = /^[0-9]{1,3}$/

/** A language tag such as `en`, `ja` or `pt-BR`. */
const LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

/** An RFC 3339 time with its offset: the date, the time with optional fractions of a second, `Z` or `±hh:mm`. */
const TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/

const MINUTE_MS = 60_000
const MARKUP = /[<>]/

/** An `invalid_argument` that says nothing was sent: `message` without its final stop. */
export function refusal(message: string): ToolError {
  return new ToolError("invalid_argument", `${message}; nothing was sent.`)
}

/** The refusal of a file under an `encrypt_dirs` directory: YouTube would hold only ciphertext, which no one could watch. */
export function encryptedFileRefusal(path: string): ToolError {
  return new ToolError(
    "forbidden",
    `"${path}" is under an encrypt_dirs directory; YouTube would hold only ciphertext, which no one could watch. Nothing was sent.`,
  )
}

const lengthOf = (text: string) => Array.from(text).length

/** `title` when it is 1 to 100 characters without `<` or `>`; `subject` names it in the refusal. */
export function checkedTitle(title: string, subject = "`title`"): string {
  const length = lengthOf(title.trim())
  if (length === 0 || lengthOf(title) > MAX_TITLE_CHARACTERS) {
    throw refusal(`${subject} must be 1 to ${MAX_TITLE_CHARACTERS} characters, not ${lengthOf(title)}`)
  }
  if (MARKUP.test(title)) throw refusal(`${subject} must not hold \`<\` or \`>\``)
  return title
}

/** `description` when it is at most 5000 bytes in UTF-8 without `<` or `>`; `subject` names it in the refusal. */
export function checkedDescription(description: string, subject = "`description`"): string {
  const bytes = Buffer.byteLength(description)
  if (bytes > MAX_DESCRIPTION_BYTES) {
    throw refusal(`${subject} must be at most ${MAX_DESCRIPTION_BYTES} bytes in UTF-8, not ${bytes}`)
  }
  if (MARKUP.test(description)) throw refusal(`${subject} must not hold \`<\` or \`>\``)
  return description
}

/** How many characters Google counts in `tags`: each one's length, 2 more for a tag with a space, and a comma between two. */
function tagCharacters(tags: readonly string[]): number {
  const own = tags.reduce((sum, tag) => sum + lengthOf(tag) + (tag.includes(" ") ? QUOTED_TAG_EXTRA : 0), 0)
  return own + Math.max(tags.length - 1, 0)
}

/** `tags` when Google counts at most 500 characters in all. */
export function checkedTagTotal(tags: readonly string[]): string[] {
  const characters = tagCharacters(tags)
  if (characters > MAX_TAG_CHARACTERS) {
    throw refusal(
      `The tags come to ${characters} characters as Google counts them (a comma between two tags, 2 more for a tag with a space), at most ${MAX_TAG_CHARACTERS} are allowed`,
    )
  }
  return [...tags]
}

/** `tags` when each is not blank and holds no `<`, `>` or `,`, and Google counts at most 500 characters in all. */
export function checkedTags(tags: readonly string[]): string[] {
  for (const tag of tags) {
    if (tag.trim() === "") throw refusal("A tag must not be blank")
    if (/[<>,]/.test(tag)) throw refusal(`The tag ${shown(tag)} must not hold \`<\`, \`>\` or a comma`)
  }
  return checkedTagTotal(tags)
}

/** `category` when it is a category id of up to three digits. */
export function checkedCategory(category: string): string {
  if (!CATEGORY_PATTERN.test(category)) {
    throw refusal(`The category ${shown(category)} is not a category id (up to three digits)`)
  }
  return category
}

/** `language` when it is a language tag such as `en` or `pt-BR`; `subject` names it in the refusal. */
export function checkedLanguage(language: string, subject = "A language"): string {
  if (!LANGUAGE_PATTERN.test(language)) {
    throw refusal(`${subject} ${shown(language)} is not a language tag such as \`en\` or \`pt-BR\``)
  }
  return language
}

/** Whether the date and time of an RFC 3339 match are ones a calendar and a clock have. */
function isRealTime([, year, month, day, hour, minute, second]: RegExpMatchArray): boolean {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day) &&
    Number(hour) <= 23 &&
    Number(minute) <= 59 &&
    Number(second) <= 59
  )
}

/** The epoch milliseconds of an RFC 3339 time with an offset, else `undefined`. */
function rfc3339Ms(value: string): number | undefined {
  const match = TIME_PATTERN.exec(value)
  if (match === null || !isRealTime(match)) return undefined
  const [, year, month, day, hour, minute, second, fraction, sign, offsetHour, offsetMinute] = match
  if (sign !== undefined && (Number(offsetHour) > 23 || Number(offsetMinute) > 59)) return undefined
  const millis = Number(`${fraction ?? ""}000`.slice(0, 3))
  const utc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    millis,
  )
  const offset = sign === undefined ? 0 : (sign === "-" ? -1 : 1) * (Number(offsetHour) * 60 + Number(offsetMinute))
  return utc - offset * MINUTE_MS
}

/** `value`, an RFC 3339 time with `Z` or an offset, as UTC ending in `Z`; anything else is `invalid_argument`. */
export function checkedPublishAt(value: string): string {
  const ms = rfc3339Ms(value)
  if (ms === undefined) {
    throw refusal(
      `\`publish_at\` ${shown(value)} is not an RFC 3339 time with an offset, such as 2026-12-24T09:00:00+09:00`,
    )
  }
  return new Date(ms).toISOString().replace(".000Z", "Z")
}
