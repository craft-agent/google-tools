import { Buffer } from "node:buffer"
import { ToolError } from "../errors"
import { shown } from "../run/ids"
import { keywordsText } from "./channel-keywords"

/** The most characters of a video's title. */
export const MAX_TITLE_CHARACTERS = 100

/** The most bytes, in UTF-8, of a video's description. */
export const MAX_DESCRIPTION_BYTES = 5000

/** The most characters of a video's tags in all, as Google counts them. */
export const MAX_TAG_CHARACTERS = 500

/** The most characters of a caption track's name. */
export const MAX_CAPTION_NAME_CHARACTERS = 150

/** The most characters of a reply, as code points. */
export const MAX_REPLY_CHARACTERS = 10_000

/** The most characters of a playlist's title. */
export const MAX_PLAYLIST_TITLE_CHARACTERS = 150

/** The most characters of a playlist's description, as code points. */
export const MAX_PLAYLIST_DESCRIPTION_CHARACTERS = 5000

/** The most characters of the note of a playlist's entry, as code points. */
export const MAX_PLAYLIST_NOTE_CHARACTERS = 280

/** The most characters of a channel's description, as code points. */
export const MAX_CHANNEL_DESCRIPTION_CHARACTERS = 1000

/** The most characters of a channel's keywords in all, as Google counts them: the text it stores. */
export const MAX_KEYWORD_CHARACTERS = 500

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
const CONTROL_CHARACTERS = /\p{Cc}/u

/** A country as Google takes it: two letters. */
const COUNTRY_PATTERN = /^[A-Za-z]{2}$/

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

/** `title` when it is 1 to `max` characters without `<` or `>`; `subject` names it in the refusal. */
function titleWithin(title: string, max: number, subject: string): string {
  const length = lengthOf(title.trim())
  if (length === 0 || lengthOf(title) > max) {
    throw refusal(`${subject} must be 1 to ${max} characters, not ${lengthOf(title)}`)
  }
  if (MARKUP.test(title)) throw refusal(`${subject} must not hold \`<\` or \`>\``)
  return title
}

/** `title` when it is 1 to 100 characters without `<` or `>`; `subject` names it in the refusal. */
export function checkedTitle(title: string, subject = "`title`"): string {
  return titleWithin(title, MAX_TITLE_CHARACTERS, subject)
}

/** `title` when it is 1 to 150 characters without `<` or `>`, as a playlist's is; `subject` names it in the refusal. */
export function checkedPlaylistTitle(title: string, subject = "`title`"): string {
  return titleWithin(title, MAX_PLAYLIST_TITLE_CHARACTERS, subject)
}

/** `description` when it is at most `max` characters without `<` or `>`; `subject` names it in the refusal. */
function descriptionWithin(description: string, max: number, subject: string): string {
  const length = lengthOf(description)
  if (length > max) throw refusal(`${subject} must be at most ${max} characters, not ${length}`)
  if (MARKUP.test(description)) throw refusal(`${subject} must not hold \`<\` or \`>\``)
  return description
}

/** `description` when it is at most 5000 characters without `<` or `>`, as a playlist's is; `subject` names it in the refusal. */
export function checkedPlaylistDescription(description: string, subject = "`description`"): string {
  return descriptionWithin(description, MAX_PLAYLIST_DESCRIPTION_CHARACTERS, subject)
}

/** `description` when it is at most 1000 characters without `<` or `>`, as a channel's is; `subject` names it in the refusal. */
export function checkedChannelDescription(description: string, subject = "`description`"): string {
  return descriptionWithin(description, MAX_CHANNEL_DESCRIPTION_CHARACTERS, subject)
}

/** `note` when it is at most 280 characters, the note of a playlist's entry. */
export function checkedPlaylistNote(note: string): string {
  const length = lengthOf(note)
  if (length > MAX_PLAYLIST_NOTE_CHARACTERS) {
    throw refusal(`\`note\` must be at most ${MAX_PLAYLIST_NOTE_CHARACTERS} characters, not ${length}`)
  }
  return note
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

/** `keywords` when each is not blank, has no space or control character at either end, and holds no `"`, which Google writes around a keyword with a space. */
export function checkedKeywords(keywords: readonly string[], subject: string): string[] {
  for (const keyword of keywords) {
    if (keyword.trim() === "") throw refusal(`${subject} must not hold a blank keyword`)
    if (keyword.includes('"')) throw refusal(`The keyword ${shown(keyword)} must not hold \`"\``)
    if (keyword !== keyword.trim() || CONTROL_CHARACTERS.test(keyword)) {
      throw refusal(`The keyword ${shown(keyword)} must not start or end with a space or hold a control character`)
    }
  }
  return [...keywords]
}

/** `keywords` when the text Google stores for them, as `keywordsText` writes it, is at most 500 characters. */
export function checkedKeywordTotal(keywords: readonly string[]): string[] {
  const characters = lengthOf(keywordsText(keywords))
  if (characters > MAX_KEYWORD_CHARACTERS) {
    throw refusal(
      `The keywords come to ${characters} characters as Google counts them (a space between two, 2 more for a keyword with a space), at most ${MAX_KEYWORD_CHARACTERS} are allowed`,
    )
  }
  return [...keywords]
}

/** `country` as Google takes it: two letters in capitals, or `""`, which removes the country. */
export function checkedCountry(country: string): string {
  if (country !== "" && !COUNTRY_PATTERN.test(country)) {
    throw refusal(`The country ${shown(country)} is not a two-letter country code such as \`JP\`; \`""\` removes it`)
  }
  return country.toUpperCase()
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

/** `text` when it is 1 to 10,000 code points and not blank. */
export function checkedReplyText(text: string): string {
  if (text.trim() === "") throw refusal("`text` must not be blank")
  const length = lengthOf(text)
  if (length > MAX_REPLY_CHARACTERS) {
    throw refusal(`\`text\` must be 1 to ${MAX_REPLY_CHARACTERS} characters, not ${length}`)
  }
  return text
}

/** `name` when it is at most 150 characters without control characters; the name may be empty. */
export function checkedCaptionName(name: string): string {
  if (lengthOf(name) > MAX_CAPTION_NAME_CHARACTERS) {
    throw refusal(`\`name\` must be at most ${MAX_CAPTION_NAME_CHARACTERS} characters, not ${lengthOf(name)}`)
  }
  if (CONTROL_CHARACTERS.test(name)) throw refusal("`name` must not hold control characters")
  return name
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
