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
  replyToId?: number | null;
  // 1/undefined = legacy RSA-wrapped (server keeps the ciphertext);
  // 2 = Signal protocol (plaintext only ever exists on devices — see lib/messageStore).
  v?: number;
  senderDeviceId?: number | null;
  // Client-only: local id for a v2 message until the server assigns `id`.
  clientId?: string | null;
};

export type CallMode = 'audio' | 'video';

export type CallState =
  | { kind: 'idle' }
  | { kind: 'outgoing'; to: string; mode: CallMode }
  | { kind: 'incoming'; from: string; offer: RTCSessionDescriptionInit; mode: CallMode }
  | { kind: 'active'; peer: string; mode: CallMode };
