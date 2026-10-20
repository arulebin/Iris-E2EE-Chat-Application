import { useCallback, useEffect, useState } from "react";
import { signalApi, type DeviceDto } from "../lib/signal/api";

type Props = {
  me: string;
  token: string;
  currentDeviceId: number | null;
};

function when(ts?: string): string {
  return ts ? new Date(ts).toLocaleDateString() : "—";
}

/** Settings → Devices: every device that can read this account's new messages. */
export function DevicesSettings({ me, token, currentDeviceId }: Props) {
  const [devices, setDevices] = useState<DeviceDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);

  const load = useCallback(
    () => signalApi.devicesOf(token, me).then(setDevices).catch(() => setError("Couldn't load devices")),
    [me, token],
  );

  useEffect(() => {
    let cancelled = false;
    signalApi.devicesOf(token, me)
      .then(list => { if (!cancelled) setDevices(list); })
      .catch(() => { if (!cancelled) setError("Couldn't load devices"); });
    return () => { cancelled = true; };
  }, [me, token, currentDeviceId]);

  async function remove(deviceId: number) {
    setRemoving(deviceId);
    setError(null);
    try {
      await signalApi.removeDevice(token, deviceId);
      await load();
    } catch {
      setError("Couldn't remove that device");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <section>
      <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
        Devices
      </p>
      <div className="bg-card rounded-2xl px-4 py-3 shadow-sm dark:border dark:border-muted-soft flex flex-col gap-2 text-sm">
        {!devices && !error && <p className="text-muted">Loading…</p>}
        {devices?.length === 0 && <p className="text-muted">No secure-messaging devices yet.</p>}
        {devices?.map(d => (
          <div key={d.deviceId} className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-navy font-semibold truncate">
                {d.label || `Device ${d.deviceId}`}
                {d.deviceId === currentDeviceId && <span className="ml-2 text-xs text-online font-semibold">This device</span>}
              </p>
              <p className="text-xs text-muted">Added {when(d.createdAt)} · active {when(d.lastSeen)}</p>
            </div>
            {d.deviceId !== currentDeviceId && (
              <button
                onClick={() => remove(d.deviceId)}
                disabled={removing !== null}
                className="shrink-0 px-3 py-1 rounded-full text-xs font-semibold border border-muted-soft text-danger hover:opacity-80 disabled:opacity-50"
              >
                {removing === d.deviceId ? "Removing…" : "Remove"}
              </button>
            )}
          </div>
        ))}
        {error && <p className="text-xs text-danger">{error}</p>}
        <p className="text-xs text-muted leading-snug">
          Remove any device you don't recognise. It stops receiving new messages
          immediately and needs your password to be set up again.
        </p>
      </div>
    </section>
  );
}
