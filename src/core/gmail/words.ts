import type { Translations } from "../words"

/** The English headline templates, fact labels, value templates and text labels the Gmail describers use. */
export const GMAIL_WORDS = {
  sendOne: "About to send {subject} to {recipient}",
  sendMany: "About to send {subject} to {recipient} and {count} more",
  outside: "Outside",
  outsideYes: "yes: {domains}",
  no: "no",
  unknown: "unknown",
  copies: "Copies",
  copiesValue: "{cc} cc, {bcc} bcc",
  replyTo: "Reply to",
  noSubject: "(no subject)",
  attachments: "Attachments",
  message: "Message",
} as const

/** The translations of the Gmail tools' words: their titles, intents, headline templates, fact labels, value templates and text labels. */
export const GMAIL_TRANSLATIONS: Translations = {
  ja: {
    "Send Gmail": "Gmail を送信する",
    "About to send an email": "メールを送信しようとしています",
    [GMAIL_WORDS.sendOne]: "{subject} を {recipient} に送信しようとしています",
    [GMAIL_WORDS.sendMany]: "{subject} を {recipient} ほか {count} 件に送信しようとしています",
    [GMAIL_WORDS.outside]: "社外への送信",
    [GMAIL_WORDS.outsideYes]: "あり: {domains}",
    [GMAIL_WORDS.no]: "なし",
    [GMAIL_WORDS.unknown]: "不明",
    [GMAIL_WORDS.copies]: "コピーでの送信",
    [GMAIL_WORDS.copiesValue]: "CC {cc} 件、BCC {bcc} 件",
    [GMAIL_WORDS.replyTo]: "返信先",
    [GMAIL_WORDS.noSubject]: "（件名なし）",
    [GMAIL_WORDS.attachments]: "添付ファイル",
    [GMAIL_WORDS.message]: "メール",
  },
}
