/**
 * Iris media & camera: public surface for the UI / messaging layers.
 *
 * Startup:  configureMedia({ apiBase, getToken, refreshToken }); setScreenSecurityAdapter(native); cleanupMediaScratch();
 *           registerMediaSendHandler(items => ...)   // see session.ts for the contract
 * Entry:    openCamera(chatId) / openPicker(chatId) / openDocumentPicker(chatId) / openViewer(items, i, origin)
 * Render:   <MediaBubble messageKey mediaId envelope viewOnce mine pending? />   (envelope = parseMediaEnvelope(text))
 */
export { configureMedia } from './config'
export type { MediaConfig } from './config'
export { openCamera, openPicker, openDocumentPicker, openViewer, useCloseMediaFlow } from './api'
export type { OpenMediaOptions } from './api'
export { registerMediaSendHandler, useUploadStatus } from './session'
export type { OutgoingMedia, ViewerItem, ViewerOrigin, MediaSendHandler } from './session'
export { MediaBubble, toViewerItem } from './ui/MediaBubble'
export type { MediaBubbleProps } from './ui/MediaBubble'
export { UploadJob, downloadMedia, getCachedMedia, saveToGallery, shareLocalFile, discardViewOnce, MediaError } from './pipeline'
export type { LocalMedia, MediaRef, PreparedMedia, MediaErrorCode } from './pipeline'
export { buildMediaEnvelope, parseMediaEnvelope } from './envelope'
export { encryptMediaBytes, decryptMediaBytes } from './mediaCrypto'
export { cleanupMediaScratch, clearDecryptedCache } from './files'
export { setScreenSecurityAdapter, screenSecurity } from './screenSecurity'
export type { ScreenSecurityAdapter } from './screenSecurity'
export { getViewOnceState, useViewOnceState } from './viewOnceStore'
export type { ViewOnceState } from './viewOnceStore'
export * from './limits'
export type { MediaEnvelope, MediaSource, EditedMedia, UploadedMedia, TransferStatus, TransferState, MediaKind } from './types'
