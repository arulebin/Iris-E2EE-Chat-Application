import type { CallState, ChatMessage } from "../types";
import { ConversationHeader } from "./ConversationHeader";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { VideoGrid } from "./VideoGrid";

type Props = {
  peer: string;
  online?: boolean;
  me: string | null;
  token: string | null;
  messages: ChatMessage[];
  input: string;
  onInputChange: (v: string) => void;
  onSend: () => void;
  onSendMedia?: (file: File, viewOnce: boolean) => Promise<void>;
  onMarkSnapViewed: (key: string) => void;
  recipientPublicKeyReady: boolean;

  // call-related
  callState: CallState;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  onStartCall: () => void;
  onHangUp: () => void;

  onBack: () => void;
};

export function ConversationView(props: Props) {
  const {
    peer,
    online,
    me,
    token,
    messages,
    input,
    onInputChange,
    onSend,
    onSendMedia,
    onMarkSnapViewed,
    recipientPublicKeyReady,
    callState,
    localStream,
    remoteStream,
    onStartCall,
    onHangUp,
    onBack,
  } = props;

  return (
    <div className="flex flex-col h-full bg-bg">
      <ConversationHeader
        peer={peer}
        online={online}
        callState={callState}
        onBack={onBack}
        onStartCall={onStartCall}
        onHangUp={onHangUp}
      />

      {(localStream || remoteStream) && (
        <div className="px-4 pt-3">
          <VideoGrid localStream={localStream} remoteStream={remoteStream} />
        </div>
      )}

      <MessageList
        messages={messages}
        me={me}
        token={token}
        onMarkSnapViewed={onMarkSnapViewed}
      />

      <MessageInput
        value={input}
        onChange={onInputChange}
        onSend={onSend}
        onSendMedia={onSendMedia}
        disabled={!recipientPublicKeyReady}
        disabledHint={
          recipientPublicKeyReady
            ? null
            : `${peer} hasn't uploaded a public key yet — ask them to log in.`
        }
      />
    </div>
  );
}
