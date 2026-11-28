import type { ToolSpec } from "./core"
import { googleAccountRead } from "./core/account/read"
import { googleCommentsAdd } from "./core/comments/add"
import { googleCommentsDelete } from "./core/comments/delete"
import { googleCommentsEdit } from "./core/comments/edit"
import { googleCommentsRead } from "./core/comments/read"
import { googleCommentsStatus } from "./core/comments/status"
import { googleDriveCopy } from "./core/drive/copy"
import { googleDriveFolderCreate } from "./core/drive/folder-create"
import { googleDriveMove } from "./core/drive/move"
import { googleDriveRead } from "./core/drive/read"
import { googleDriveRename } from "./core/drive/rename"
import { googleDriveRestore } from "./core/drive/restore"
import { googleDriveTrash } from "./core/drive/trash"
import { googleDriveUpload } from "./core/drive/upload"
import { googleGmailDraftCreate } from "./core/gmail/draft-create"
import { googleGmailDraftDelete } from "./core/gmail/draft-delete"
import { googleGmailDraftEdit } from "./core/gmail/draft-edit"
import { googleGmailLabel } from "./core/gmail/label"
import { googleGmailLabelCreate } from "./core/gmail/label-create"
import { googleGmailRead } from "./core/gmail/read"
import { googleGmailSend } from "./core/gmail/send"
import { googleGmailTrash } from "./core/gmail/trash"
import { googleRunRead } from "./core/run/read"
import { googleRunServiceDeploy } from "./core/run/deploy"
import { googleRunExecutionCancel } from "./core/run/execution-cancel"
import { googleRunJobDeploy } from "./core/run/job-deploy"
import { googleRunJobDelete } from "./core/run/job-delete"
import { googleRunJobRun } from "./core/run/job-run"
import { googleRunRevisionDelete } from "./core/run/revision-delete"
import { googleRunServiceDelete } from "./core/run/service-delete"
import { googleRunTrafficSet } from "./core/run/traffic"
import { googleSheetsAdd } from "./core/sheets/add"
import { googleSheetsAppend } from "./core/sheets/append"
import { googleSheetsClear } from "./core/sheets/clear"
import { googleSheetsCreate } from "./core/sheets/create"
import { googleSheetsEdit } from "./core/sheets/edit"
import { googleSheetsFormat } from "./core/sheets/format"
import { googleSheetsProtect } from "./core/sheets/protect"
import { googleSheetsRead } from "./core/sheets/read"
import { googleSheetsRestructure } from "./core/sheets/restructure"
import { googleSheetsTabAdd } from "./core/sheets/tab-add"
import { googleSheetsTransform } from "./core/sheets/transform"
import { googleYoutubeCaptionAdd } from "./core/youtube/caption-add"
import { googleYoutubeCaptionUpdate } from "./core/youtube/caption-update"
import { googleYoutubeChannelEdit } from "./core/youtube/channel-edit"
import { googleYoutubeCommentModerate } from "./core/youtube/comment-moderate"
import { googleYoutubeCommentReject } from "./core/youtube/comment-reject"
import { googleYoutubeCommentReply } from "./core/youtube/comment-reply"
import { googleYoutubePlaylistAdd } from "./core/youtube/playlist-add"
import { googleYoutubePlaylistCreate } from "./core/youtube/playlist-create"
import { googleYoutubePlaylistEdit } from "./core/youtube/playlist-edit"
import { googleYoutubePlaylistMove } from "./core/youtube/playlist-move"
import { googleYoutubePlaylistRemove } from "./core/youtube/playlist-remove"
import { googleYoutubePrivacySet } from "./core/youtube/privacy"
import { googleYoutubeRead } from "./core/youtube/read"
import { googleYoutubeThumbnailSet } from "./core/youtube/thumbnail"
import { googleYoutubeVideoEdit } from "./core/youtube/video-edit"
import { googleYoutubeVideoUpload } from "./core/youtube/video-upload"

/** Every tool spec of the package; entry points register their tools from this list. */
export const ALL_TOOLS: ToolSpec[] = [
  googleAccountRead,
  googleSheetsRead,
  googleSheetsAppend,
  googleSheetsEdit,
  googleSheetsClear,
  googleSheetsCreate,
  googleSheetsTabAdd,
  googleSheetsFormat,
  googleSheetsAdd,
  googleSheetsRestructure,
  googleSheetsTransform,
  googleSheetsProtect,
  googleGmailRead,
  googleGmailSend,
  googleGmailDraftCreate,
  googleGmailDraftEdit,
  googleGmailDraftDelete,
  googleGmailLabel,
  googleGmailLabelCreate,
  googleGmailTrash,
  googleDriveRead,
  googleDriveUpload,
  googleDriveFolderCreate,
  googleDriveCopy,
  googleDriveRename,
  googleDriveMove,
  googleDriveTrash,
  googleDriveRestore,
  googleCommentsRead,
  googleCommentsAdd,
  googleCommentsStatus,
  googleCommentsEdit,
  googleCommentsDelete,
  googleRunRead,
  googleRunServiceDeploy,
  googleRunTrafficSet,
  googleRunJobDeploy,
  googleRunJobRun,
  googleRunExecutionCancel,
  googleRunRevisionDelete,
  googleRunServiceDelete,
  googleRunJobDelete,
  googleYoutubeRead,
  googleYoutubeVideoEdit,
  googleYoutubePrivacySet,
  googleYoutubeThumbnailSet,
  googleYoutubeVideoUpload,
  googleYoutubeCaptionAdd,
  googleYoutubeCaptionUpdate,
  googleYoutubeCommentReply,
  googleYoutubeCommentModerate,
  googleYoutubeCommentReject,
  googleYoutubePlaylistCreate,
  googleYoutubePlaylistEdit,
  googleYoutubePlaylistAdd,
  googleYoutubePlaylistMove,
  googleYoutubePlaylistRemove,
  googleYoutubeChannelEdit,
]
