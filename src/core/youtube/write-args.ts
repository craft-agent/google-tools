import { z } from "zod"

/** The `video` argument of the tools that change a video of the label's channel. */
export const videoArg = z
  .string()
  .describe(
    "The video's id, or its YouTube address (https://www.youtube.com/watch?v=<id>). It must be the channel's own.",
  )
