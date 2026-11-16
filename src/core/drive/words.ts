import type { Translations } from "../words"

/** The English headline templates, fact labels and value templates the Drive describers use. */
export const DRIVE_WORDS = {
  upload: "About to upload {name} to {folder}",
  from: "From",
  type: "Type",
  encrypted: "Encrypted",
  encryptedOne: "yes, with age to {count} recipient",
  encryptedMany: "yes, with age to {count} recipients",
  notEncrypted: "no",
  alreadyThere: "Already there",
  alreadyOne: "{count} file named so",
  alreadyMany: "{count} files named so",
} as const

/** The translations of the Drive tools' words: their titles, intents, headline templates, fact labels and value templates. */
export const DRIVE_TRANSLATIONS: Translations = {
  ja: {
    "Upload to Drive": "Drive にアップロードする",
    "About to upload a file to Drive": "ファイルを Drive にアップロードしようとしています",
    [DRIVE_WORDS.upload]: "{name} を {folder} にアップロードしようとしています",
    [DRIVE_WORDS.from]: "元のファイル",
    [DRIVE_WORDS.type]: "種類",
    [DRIVE_WORDS.encrypted]: "暗号化",
    [DRIVE_WORDS.encryptedOne]: "する (age、宛先 {count} 件)",
    [DRIVE_WORDS.encryptedMany]: "する (age、宛先 {count} 件)",
    [DRIVE_WORDS.notEncrypted]: "なし",
    [DRIVE_WORDS.alreadyThere]: "同じ名前のファイル",
    [DRIVE_WORDS.alreadyOne]: "{count} 件あります",
    [DRIVE_WORDS.alreadyMany]: "{count} 件あります",
  },
}
