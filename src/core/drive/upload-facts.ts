import { sizeFact } from "../facts"
import type { CallDescription, CallFact } from "../tool"
import type { UploadPlan } from "./upload-plan"
import { DRIVE_WORDS } from "./words"

/** What the headline calls the top of My Drive. */
const MY_DRIVE = "My Drive"

/** The pin that holds the SHA-256 of the file's content. */
const CONTENT_PIN = "content"

/** The pin that holds the digest of the folder's id, drive, trash state and permissions. */
const FOLDER_PIN = "folder"

/** The `Already there` fact: how many files of the same name the folder holds; the upload adds another and never replaces one. */
function existingFact(count: number): CallFact {
  return {
    label: DRIVE_WORDS.alreadyThere,
    value: { text: count === 1 ? DRIVE_WORDS.alreadyOne : DRIVE_WORDS.alreadyMany, values: { count } },
  }
}

/**
 * What the prompt shows of an upload: the name and the folder in the headline,
 * then the file's real path, its size and type and, when the folder holds files
 * of that name already, how many. The file's SHA-256 and the folder's digest
 * are pins, so a call whose file or folder changed after the prompt is `stale`.
 */
export function describeUpload(plan: UploadPlan): CallDescription {
  const { file, name, mimeType, destination, existing } = plan
  return {
    headline: { text: DRIVE_WORDS.upload, values: { name, folder: destination.name ?? MY_DRIVE } },
    facts: [
      { label: DRIVE_WORDS.from, value: file.path },
      sizeFact(file.size),
      { label: DRIVE_WORDS.type, value: mimeType },
      ...(existing > 0 ? [existingFact(existing)] : []),
    ],
    pins: { [CONTENT_PIN]: file.sha256, [FOLDER_PIN]: destination.pin },
  }
}
