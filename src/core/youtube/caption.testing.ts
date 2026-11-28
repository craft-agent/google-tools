/** A made-up caption file with its own timings, which is all the caption tools can tell of one. */
export const SRT =
  "1\n00:00:01,000 --> 00:00:03,000\nHello, made-up world.\n2\n00:00:04,000 --> 00:00:06,000\nこんにちは。\n"

/** The most bytes of a caption file, as Google counts them. */
export const HUNDRED_MB = 100 * 1000 * 1000

/** A caption file that is not valid UTF-8: a Latin-1 `é` (0xE9) between two lines. */
export const LATIN1_SRT = new Uint8Array([
  ...Buffer.from("1\n00:00:01,000 --> 00:00:03,000\ncaf"),
  0xe9,
  ...Buffer.from("\n"),
])
