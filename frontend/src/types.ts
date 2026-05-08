// Shared types used across the app + extracted components

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

export type CallState =
  | { kind: 'idle' }
  | { kind: 'outgoing'; to: string }
  | { kind: 'incoming'; from: string; offer: RTCSessionDescriptionInit }
  | { kind: 'active'; peer: string };
