import type { Translations } from "../words"

/** The English headline templates, fact labels, value templates and text labels the comment describers use. */
export const COMMENTS_WORDS = {
  commentAt: "About to comment on {file} at {cell}",
  comment: "About to comment on {file}",
  reply: "About to reply to a comment on {file}",
  emailed: "Emailed",
  nobody: "nobody",
  replyingTo: "Replying to",
  status: "Status",
  resolved: "resolved",
  text: "Comment",
} as const

/** The translations of the comment tools' words: their titles, intents, headline templates, fact labels, value templates and text labels. */
export const COMMENTS_TRANSLATIONS: Translations = {
  ja: {
    "Add a comment": "コメントを追加する",
    "About to add a comment": "コメントを追加しようとしています",
    [COMMENTS_WORDS.commentAt]: "{file} のセル {cell} にコメントしようとしています",
    [COMMENTS_WORDS.comment]: "{file} にコメントしようとしています",
    [COMMENTS_WORDS.reply]: "{file} のコメントに返信しようとしています",
    [COMMENTS_WORDS.emailed]: "メールが届く人",
    [COMMENTS_WORDS.nobody]: "なし",
    [COMMENTS_WORDS.replyingTo]: "返信先",
    [COMMENTS_WORDS.status]: "状態",
    [COMMENTS_WORDS.resolved]: "解決済み",
    [COMMENTS_WORDS.text]: "コメント",
  },
}
