import type { Translations } from "../words"

/** The English headline templates, fact labels, value templates and text labels the comment describers use. */
export const COMMENTS_WORDS = {
  commentAt: "About to comment on {file} at {cell}",
  comment: "About to comment on {file}",
  reply: "About to reply to a comment on {file}",
  resolve: "About to resolve a comment on {file}",
  reopen: "About to reopen a comment on {file}",
  alreadyResolved: "The comment on {file} is already resolved",
  alreadyOpen: "The comment on {file} is already open",
  emailed: "Emailed",
  nobody: "nobody",
  replyingTo: "Replying to",
  thread: "Thread",
  at: "At",
  status: "Status",
  resolved: "resolved",
  text: "Comment",
} as const

/** The translations of the comment tools' words: their titles, intents, headline templates, fact labels, value templates and text labels. */
export const COMMENTS_TRANSLATIONS: Translations = {
  ja: {
    "Add a comment": "コメントを追加する",
    "About to add a comment": "コメントを追加しようとしています",
    "Resolve or reopen a comment": "コメントを解決または再開する",
    "About to change a comment's status": "コメントの状態を変更しようとしています",
    [COMMENTS_WORDS.commentAt]: "{file} のセル {cell} にコメントしようとしています",
    [COMMENTS_WORDS.comment]: "{file} にコメントしようとしています",
    [COMMENTS_WORDS.reply]: "{file} のコメントに返信しようとしています",
    [COMMENTS_WORDS.resolve]: "{file} のコメントを解決しようとしています",
    [COMMENTS_WORDS.reopen]: "{file} のコメントを再開しようとしています",
    [COMMENTS_WORDS.alreadyResolved]: "{file} のコメントはすでに解決済みです",
    [COMMENTS_WORDS.alreadyOpen]: "{file} のコメントはすでに未解決です",
    [COMMENTS_WORDS.emailed]: "メールが届く人",
    [COMMENTS_WORDS.nobody]: "なし",
    [COMMENTS_WORDS.replyingTo]: "返信先",
    [COMMENTS_WORDS.thread]: "スレッド",
    [COMMENTS_WORDS.at]: "場所",
    [COMMENTS_WORDS.status]: "状態",
    [COMMENTS_WORDS.resolved]: "解決済み",
    [COMMENTS_WORDS.text]: "コメント",
  },
}
