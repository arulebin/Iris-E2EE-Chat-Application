import type { CallState, UserProfile } from "../types";
import { Avatar } from "./Avatar";
import { BackIcon, MoreIcon, PhoneIcon, ShieldCheckIcon, VideoIcon } from "./icons";

type Props = {
  peer: string;
  peerProfile?: UserProfile;
  online?: boolean;
  typing?: boolean;
  callState: CallState;
  onBack: () => void;
  onStartVoiceCall: () => void;
  onStartVideoCall: () => void;
  onHangUp: () => void;
  verified?: boolean;
  onVerify?: () => void;
};

export function ConversationHeader({
  peer,
  peerProfile,
  online,
  typing,
  callState,
  onBack,
  onStartVoiceCall,
  onStartVideoCall,
  onHangUp,
  verified,
  onVerify,
}: Props) {
  const inCall = callState.kind === "outgoing" || callState.kind === "active";
  const subtitle =
    callState.kind === "outgoing"
      ? "calling..."
      : callState.kind === "active"
      ? "in call"
      : typing
      ? "typing..."
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

      <Avatar name={peerProfile?.preferredName || peer} avatarUrl={peerProfile?.avatarUrl} size="md" online={online} />

      <div className="flex-1 min-w-0">
        <p className="font-bold text-navy truncate flex items-center gap-1">
          <span className="truncate">{peerProfile?.preferredName || peer}</span>
          {verified && (
            <span className="text-online shrink-0" title="Safety number verified">
              <ShieldCheckIcon className="w-4 h-4" />
            </span>
          )}
        </p>
        {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
      </div>

      {inCall ? (
        <button
          onClick={onHangUp}
          className="bg-danger hover:bg-danger-hover text-white px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5"
        >
          <PhoneIcon className="w-4 h-4 rotate-[135deg]" />
          End
        </button>
      ) : (
        <div className="flex items-center">
          <button
            onClick={onStartVideoCall}
            className="text-navy hover:opacity-70 p-2"
            aria-label={`Video call ${peer}`}
          >
            <VideoIcon />
          </button>
          <button
            onClick={onStartVoiceCall}
            className="text-navy hover:opacity-70 p-2"
            aria-label={`Voice call ${peer}`}
          >
            <PhoneIcon />
          </button>
        </div>
      )}

      {onVerify && (
        <button
          onClick={onVerify}
          className="text-navy hover:opacity-70 p-2"
          aria-label="Verify safety number"
          title="Verify safety number"
        >
          <ShieldCheckIcon />
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
