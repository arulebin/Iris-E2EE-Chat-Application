import type { CallState } from "../types";
import { Avatar } from "./Avatar";
import { BackIcon, MoreIcon, PhoneIcon } from "./icons";

type Props = {
  peer: string;
  online?: boolean;
  callState: CallState;
  onBack: () => void;
  onStartCall: () => void;
  onHangUp: () => void;
};

export function ConversationHeader({
  peer,
  online,
  callState,
  onBack,
  onStartCall,
  onHangUp,
}: Props) {
  const inCall = callState.kind === "outgoing" || callState.kind === "active";
  const subtitle =
    callState.kind === "outgoing"
      ? "calling..."
      : callState.kind === "active"
      ? "in call"
      : online
      ? "online"
      : "";

  return (
    <header className="flex items-center gap-3 px-3 py-3 border-b border-muted-soft/30 bg-bg">
      <button
        onClick={onBack}
        className="p-1 text-navy hover:opacity-70"
        aria-label="Back"
      >
        <BackIcon />
      </button>

      <Avatar name={peer} size="md" online={online} />

      <div className="flex-1 min-w-0">
        <p className="font-bold text-navy truncate">{peer}</p>
        {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
      </div>

      {inCall ? (
        <button
          onClick={onHangUp}
          className="bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5"
        >
          <PhoneIcon className="w-4 h-4 rotate-[135deg]" />
          End
        </button>
      ) : (
        <button
          onClick={onStartCall}
          className="text-navy hover:opacity-70 p-2"
          aria-label={`Call ${peer}`}
        >
          <PhoneIcon />
        </button>
      )}

      <button
        className="text-navy hover:opacity-70 p-1"
        aria-label="More"
      >
        <MoreIcon />
      </button>
    </header>
  );
}
