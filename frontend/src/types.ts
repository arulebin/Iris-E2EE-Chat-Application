// Shared types used across the app + extracted components

export type ChatMessage = {
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
};

export type CallState =
  | { kind: 'idle' }
  | { kind: 'outgoing'; to: string }
  | { kind: 'incoming'; from: string; offer: RTCSessionDescriptionInit }
  | { kind: 'active'; peer: string };
