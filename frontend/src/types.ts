// Shared types used across the app + extracted components

export type UserProfile = {
  username: string;
  preferredName?: string;
  avatarUrl?: string;
  shareId?: string;
};

export type FriendRequest = {
  id: number;
  fromUser: string;
  toUser: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  createdAt: string;
};

export type ChatMessage = {
  id?: number | null;
  from: string;
  to: string;
  content: string;
  encryptedKeyForSender?: string | null;
  encryptedKeyForRecipient?: string | null;
  mediaId?: string | null;
  mimeType?: string | null;
  // Client-only: AES key for E2E media, recovered from the decrypted envelope.
  // Absent for legacy (server-encrypted-at-rest) media.
  mediaKey?: string | null;
  viewOnce?: boolean;
  viewedAt?: string | null;
  sentAt: string;
  // When the recipient opened the conversation (server-tracked, metadata only).
  readAt?: string | null;
  replyToId?: number | null;
  // 1/undefined = legacy RSA-wrapped (server keeps the ciphertext);
  // 2 = Signal protocol (plaintext only ever exists on devices — see lib/messageStore).
  v?: number;
  senderDeviceId?: number | null;
  // Client-only: local id for a v2 message until the server assigns `id`.
  clientId?: string | null;
  // Group messages: the group's id (history is filed under the pseudo-peer `group:<id>`).
  groupId?: string | null;
  // Client-only: a system line ("Alice added Bob") rather than a chat message.
  system?: boolean;
};

export type CallMode = 'audio' | 'video';

// callId ties every signal to one call, so stray or stale signals (another caller
// giving up, a previous call's late call-end) can't touch the current one.
export type CallState =
  | { kind: 'idle' }
  | { kind: 'outgoing'; to: string; mode: CallMode; callId: string }
  | { kind: 'incoming'; from: string; offer: RTCSessionDescriptionInit; mode: CallMode; callId: string }
  | { kind: 'active'; peer: string; mode: CallMode; callId: string; role: 'caller' | 'callee'; startedAt: number };
