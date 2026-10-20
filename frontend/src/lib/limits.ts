// Longest text message. A send carries one ciphertext per target device (padded,
// base64'd — ~1.4× the UTF-8 size each), and the server accepts WebSocket frames
// up to 1 MB. 16 000 characters keeps even 3-byte scripts (Tamil, Malayalam, …)
// sent to ~10 devices comfortably under that.
export const MAX_MESSAGE_CHARS = 16_000
