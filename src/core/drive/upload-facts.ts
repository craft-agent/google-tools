import { createHash } from "node:crypto"
import { sizeFact } from "../facts"
import { canonicalJson } from "../pin"
import type { CallDescription, CallFact } from "../tool"
import type { UploadEncryption, UploadPlan } from "./upload-plan"
import { DRIVE_WORDS } from "./words"

/** What the headline calls the top of My Drive. */
const MY_DRIVE = "My Drive"

/** The pin that holds the SHA-256 of the file's content. */
const CONTENT_PIN = "content"

/** The pin that holds the digest of the folder's id, drive, trash state and permissions. */
const FOLDER_PIN = "folder"

/** The pin that holds the digest of the sorted recipient list of an encrypted file. */
const RECIPIENTS_PIN = "recipients"

/** The `Already there` fact: how many files of the same name the folder holds; the upload adds another and never replaces one. */
function existingFact(count: number): CallFact {
  return {
    label: DRIVE_WORDS.alreadyThere,
    value: { text: count === 1 ? DRIVE_WORDS.alreadyOne : DRIVE_WORDS.alreadyMany, values: { count } },
  }
}

/** The `Encrypted` fact: how many recipients the file is encrypted to with age, or `no` for a file outside the encryption directories; none when no encryption directory is set. */
function encryptedFacts(encryption: UploadEncryption): CallFact[] {
  if (encryption.kind === "unset") return []
  if (encryption.kind === "outside") {
    return [{ label: DRIVE_WORDS.encrypted, value: { text: DRIVE_WORDS.notEncrypted } }]
  }
  const count = encryption.recipients.length
  const text = count === 1 ? DRIVE_WORDS.encryptedOne : DRIVE_WORDS.encryptedMany
  return [{ label: DRIVE_WORDS.encrypted, value: { text, values: { count } } }]
}

/** The pin that holds the digest of the recipients a file is encrypted to. */
function recipientsPin(recipients: readonly string[]): string {
  return createHash("sha256").update(canonicalJson(recipients)).digest("hex")
}

/**
 * What the prompt shows of an upload: the name and the folder in the headline,
 * then the file's real path, whether it goes up encrypted (when the setting for
 * that is in use), its size (the plaintext's) and type and, when the folder
 * holds files of that name already, how many. The file's SHA-256, the folder's
 * digest and, for an encrypted file, a digest of the recipients are pins, so a
 * call whose file, folder or recipients changed after the prompt is `stale`.
 */
export function describeUpload(plan: UploadPlan): CallDescription {
  const { file, name, mimeType, encryption, destination, existing } = plan
  return {
    headline: { text: DRIVE_WORDS.upload, values: { name, folder: destination.name ?? MY_DRIVE } },
    facts: [
      { label: DRIVE_WORDS.from, value: file.path },
      ...encryptedFacts(encryption),
      sizeFact(file.size),
      { label: DRIVE_WORDS.type, value: mimeType },
      ...(existing > 0 ? [existingFact(existing)] : []),
    ],
    pins: {
      [CONTENT_PIN]: file.sha256,
      [FOLDER_PIN]: destination.pin,
      ...(encryption.kind === "age" ? { [RECIPIENTS_PIN]: recipientsPin(encryption.recipients) } : {}),
    },
  }
}
