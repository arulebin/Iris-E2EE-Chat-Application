type Props = {
  peerName: string;
  onAccept: () => void;
  onVerify: () => void;
};

/** Shown while a contact's key differs from the pinned one. Sending stays blocked until accepted. */
export function KeyChangedBanner({ peerName, onAccept, onVerify }: Props) {
  return (
    <div role="alert" className="mx-3 mt-3 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm">
      <p className="font-semibold text-danger">{peerName}'s security key changed</p>
      <p className="mt-1 text-navy-muted">
        This happens if they reinstalled or reset their account, but it can also mean
        someone is intercepting the chat. Sending is paused until you accept the new key.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          onClick={onVerify}
          className="px-3 py-1.5 rounded-full text-xs font-semibold border border-muted-soft text-navy hover:opacity-80"
        >
          Verify safety number
        </button>
        <button
          onClick={onAccept}
          className="px-3 py-1.5 rounded-full text-xs font-semibold bg-danger hover:bg-danger-hover text-white"
        >
          Accept new key
        </button>
      </div>
    </div>
  );
}
