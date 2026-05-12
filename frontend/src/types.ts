// Shared types used across the app + extracted components

export type UserProfile = {
  username: string;
  preferredName?: string;
  avatarUrl?: string;
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
  viewOnce?: boolean;
  viewedAt?: string | null;
  sentAt: string;
  replyToId?: number | null;
};

export type CallMode = 'audio' | 'video';

export type CallState =
  | { kind: 'idle' }
  | { kind: 'outgoing'; to: string; mode: CallMode }
  | { kind: 'incoming'; from: string; offer: RTCSessionDescriptionInit; mode: CallMode }
  | { kind: 'active'; peer: string; mode: CallMode };
