type Props = {
  from: string;
  onAccept: () => void;
  onReject: () => void;
};

export function IncomingCallModal({ from, onAccept, onReject }: Props) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-2xl p-6 shadow-xl max-w-sm w-full mx-4">
        <h2 className="text-lg font-bold text-navy">
          📞 Incoming call from {from}
        </h2>
        <p className="text-sm text-muted mt-1">
          Camera and microphone will turn on if you accept.
        </p>
        <div className="flex gap-2 mt-4 justify-end">
          <button
            onClick={onReject}
            className="bg-muted-soft hover:bg-muted text-navy px-4 py-1.5 rounded-lg text-sm font-semibold"
          >
            Reject
          </button>
          <button
            onClick={onAccept}
            className="bg-primary hover:bg-primary-hover text-white px-4 py-1.5 rounded-lg text-sm font-semibold"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
