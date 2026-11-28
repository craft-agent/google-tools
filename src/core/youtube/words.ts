import type { Translations } from "../words"

/** The English headline templates, fact labels, value templates and text labels the YouTube describers use. */
export const YOUTUBE_WORDS = {
  videoEdit: "About to edit {title}",
  privacy: "Privacy",
  fields: "Fields",
  newValues: "New values",
  public: "public",
  unlisted: "unlisted",
  private: "private",
  privateUntil: "private until {time}",
} as const

/** The translations of the YouTube tools' words: their titles, intents, headline templates, fact labels, value templates and text labels. */
export const YOUTUBE_TRANSLATIONS: Translations = {
  ja: {
    "Edit YouTube video": "YouTube 動画を編集する",
    "About to edit a YouTube video": "YouTube 動画を編集しようとしています",
    [YOUTUBE_WORDS.videoEdit]: "{title} を編集しようとしています",
    [YOUTUBE_WORDS.privacy]: "公開設定",
    [YOUTUBE_WORDS.fields]: "変更する項目",
    [YOUTUBE_WORDS.newValues]: "新しい値",
    [YOUTUBE_WORDS.public]: "公開",
    [YOUTUBE_WORDS.unlisted]: "限定公開",
    [YOUTUBE_WORDS.private]: "非公開",
    [YOUTUBE_WORDS.privateUntil]: "{time} まで非公開",
  },
}
