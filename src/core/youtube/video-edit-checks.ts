import { checkedCategory, checkedDescription, checkedLanguage, checkedTags, checkedTitle, refusal } from "./checks"
import { checkLocalizations } from "./localizations"
import type { YoutubeVideoEditArgs } from "./video-edit-args"

/** The tags both added and removed, if any. */
const contradiction = (added: readonly string[], removed: readonly string[]) =>
  added.find((tag) => removed.includes(tag))

/**
 * Refuses, before anything is read or sent, an edit that changes nothing, adds
 * and removes the same tag, sets and removes the same language, or holds a
 * value outside Google's limits.
 */
export function checkEdit(args: YoutubeVideoEditArgs): void {
  const { account: _account, video: _video, ...changes } = args
  if (Object.values(changes).every((value) => value === undefined)) {
    throw refusal("Give at least one thing to change")
  }
  if (args.title !== undefined) checkedTitle(args.title)
  if (args.description !== undefined) checkedDescription(args.description)
  if (args.category !== undefined) checkedCategory(args.category)
  if (args.default_language !== undefined) checkedLanguage(args.default_language, "`default_language`")
  if (args.default_audio_language !== undefined) {
    checkedLanguage(args.default_audio_language, "`default_audio_language`")
  }
  if (args.add_tags !== undefined) checkedTags(args.add_tags)
  const both = contradiction(args.add_tags ?? [], args.remove_tags ?? [])
  if (both !== undefined) throw refusal(`The tag ${JSON.stringify(both)} is both added and removed`)
  checkLocalizations(args, { title: checkedTitle, description: checkedDescription })
}
