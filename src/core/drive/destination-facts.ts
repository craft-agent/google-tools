import type { CallFact } from "../tool"
import type { Destination } from "./upload-destination"
import { DRIVE_WORDS } from "./words"

/** What a headline calls the top of My Drive. */
const MY_DRIVE = "My Drive"

/** The pin that holds the digest of the folder's id, drive, trash state and permissions. */
export const FOLDER_PIN = "folder"

/** The name a headline shows for a destination: the folder's own, or `My Drive` for the top. */
export function folderName(destination: Destination): string {
  return destination.name ?? MY_DRIVE
}

/** The `Already there` fact: how many files of the same name the folder holds; the call adds another and never replaces one. */
export function existingFact(count: number): CallFact {
  return {
    label: DRIVE_WORDS.alreadyThere,
    value: { text: count === 1 ? DRIVE_WORDS.alreadyOne : DRIVE_WORDS.alreadyMany, values: { count } },
  }
}
