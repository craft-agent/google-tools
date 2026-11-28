import type { ModerationPlan } from "./comment-moderation-plan"
import { youtubeError } from "./errors"
import { YOUTUBE_ROUTES } from "./routes"

/** Sets the planned comments to the planned status, banning their authors when the plan says so; Google answers 204 and nothing more. */
export async function sendModeration({ session, ids, status, ban }: ModerationPlan): Promise<void> {
  try {
    await session.client.request(YOUTUBE_ROUTES.commentsModerate, {
      query: { id: ids.join(","), moderationStatus: status, banAuthor: ban ? true : undefined },
    })
  } catch (error) {
    throw youtubeError(error)
  }
}
