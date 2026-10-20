import { useState } from "react";
import type { CallState, ChatMessage, UserProfile } from "../types";
import { ConversationHeader } from "./ConversationHeader";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { KeyChangedBanner } from "./KeyChangedBanner";
import { SafetyNumberView } from "./SafetyNumberView";
import { acknowledgeKeyChange } from "../lib/fingerprint";
import { useContactTrust } from "../lib/useContactTrust";

type Props = {
  peer: string;
  peerProfile?: UserProfile;
  online?: boolean;
  typing?: boolean;
  peerReadAt?: number;
  me: string | null;
  token: string | null;
  messages: ChatMessage[];
  input: string;
  onInputChange: (v: string) => void;
  /** Rejects with a user-facing Error when the message couldn't be sent. */
  onSend: () => Promise<void>;
  onSendMedia?: (file: File, viewOnce: boolean) => Promise<void>;
  onMarkSnapViewed: (key: string) => void;
  recipientPublicKeyReady: boolean;

  // reply
  replyTo: ChatMessage | null;
  onStartReply: (msg: ChatMessage) => void;
  onCancelReply: () => void;

  // call-related
  callState: CallState;
  onStartVoiceCall: () => void;
  onStartVideoCall: () => void;
  onHangUp: () => void;

  onBack: () => void;
};

export function ConversationView(props: Props) {
  const {
    peer,
    peerProfile,
    online,
    typing,
    peerReadAt,
    me,
    token,
    messages,
    input,
    onInputChange,
    onSend,
    onSendMedia,
    onMarkSnapViewed,
    recipientPublicKeyReady,
    replyTo,
    onStartReply,
    onCancelReply,
    callState,
    onStartVoiceCall,
    onStartVideoCall,
    onHangUp,
    onBack,
  } = props;

  const trust = useContactTrust(me, peer);
  const [showSafetyNumber, setShowSafetyNumber] = useState(false);
  const peerName = peerProfile?.preferredName || peer;
  const keyChanged = trust?.changed === true;

  return (
    <div className="flex flex-col h-full bg-bg">
      <ConversationHeader
        verified={trust?.verified === true && !keyChanged}
        onVerify={me && token ? () => setShowSafetyNumber(true) : undefined}
        peer={peer}
        peerProfile={peerProfile}
        online={online}
        typing={typing}
        callState={callState}
        onBack={onBack}
        onStartVoiceCall={onStartVoiceCall}
        onStartVideoCall={onStartVideoCall}
        onHangUp={onHangUp}
      />

      {keyChanged && me && (
        <KeyChangedBanner
          peerName={peerName}
          onAccept={() => { acknowledgeKeyChange(me, peer).catch(console.error); }}
          onVerify={() => setShowSafetyNumber(true)}
        />
      )}

      {showSafetyNumber && me && token && (
        <SafetyNumberView
          me={me}
          peer={peer}
          peerName={peerName}
          token={token}
          trust={trust}
          onClose={() => setShowSafetyNumber(false)}
        />
      )}

      <MessageList
        messages={messages}
        me={me}
        token={token}
        onMarkSnapViewed={onMarkSnapViewed}
        onStartReply={onStartReply}
        peerReadAt={peerReadAt}
      />

      <MessageInput
        value={input}
        onChange={onInputChange}
        onSend={onSend}
        onSendMedia={onSendMedia}
        disabled={!recipientPublicKeyReady || keyChanged}
        disabledHint={
          keyChanged
            ? `Accept ${peerName}'s new security key to keep chatting.`
            : recipientPublicKeyReady
            ? null
            : `${peer} hasn't uploaded a public key yet — ask them to log in.`
        }
        replyTo={replyTo}
        onCancelReply={onCancelReply}
      />
    </div>
  );
}
