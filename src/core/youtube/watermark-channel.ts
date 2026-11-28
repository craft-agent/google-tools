import { createHash } from "node:crypto"
import { canonicalJson } from "../pin"
import { youtubeError } from "./errors"
import { ownChannel, type OwnSession } from "./own-calls"

/** The label's channel as the watermark calls name it: its id, its name for the prompt and the digest of both, which the prompt pins. */
export type WatermarkChannel = { id: string; title: string; pin: string }

/** The label's channel (an account with no channel is `not_found`), Google's failures as `youtubeError` makes them. */
export async function readWatermarkChannel(session: OwnSession): Promise<WatermarkChannel> {
  try {
    const { id, snippet } = await ownChannel(session, "snippet")
    const title = snippet?.title ?? id
    return { id, title, pin: createHash("sha256").update(canonicalJson({ id, title })).digest("hex") }
  } catch (error) {
    throw youtubeError(error)
  }
}
