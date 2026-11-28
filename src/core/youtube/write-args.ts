import { z } from "zod"

/** The `video` argument of the tools that change a video of the label's channel. */
export const videoArg = z
  .string()
  .describe(
    "The video's id, or its YouTube address (https://www.youtube.com/watch?v=<id>). It must be the channel's own.",
  )

/** The `playlist` argument of the tools that change a playlist of the label's channel. */
export const playlistArg = z
  .string()
  .describe(
    "The playlist's id, or its YouTube address (https://www.youtube.com/playlist?list=<id>). It must be one of the channel's own playlists, and never the uploads playlist.",
  )
