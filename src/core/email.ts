/** The most characters of one email address. */
export const MAX_EMAIL_LENGTH = 100

/** A plain email address, `local@domain`, with no display name, no list and no quote. */
export const EMAIL_PATTERN = /^[^@\s,;<>"']{1,64}@[^@\s,;<>"']+\.[^@\s,;<>"']{2,}$/
