import { useState } from "react";
import { IrisMark, LockIcon, EyeIcon, EyeOffIcon } from "./icons";

type Props = {
  me: string | null;
  error: string | null;
  onUnlock: (password: string) => void;
  onLogout: () => void;
};

// Shown when the app is logged in (valid token) but the encrypted private key
// isn't in this browser's storage and no password is in memory to restore it.
// Re-entering the password derives the KEK and recovers the SAME key from the
// server backup — it never generates a new keypair.
export function UnlockKeyView({ me, error, onUnlock, onLogout }: Props) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password) onUnlock(password);
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-bg flex flex-col items-center justify-center px-6">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
        <div className="relative mt-[-22vh] w-[150vw] max-w-[640px] aspect-square">
          <span className="absolute inset-0 rounded-full border border-primary/10" />
          <span className="absolute inset-[13%] rounded-full border border-primary/10" />
          <span className="absolute inset-[26%] rounded-full border border-primary/[0.08]" />
        </div>
      </div>

      <div className="iris-rise relative z-10 flex flex-col items-center mb-7">
        <IrisMark className="w-14 h-14" />
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight iris-wordmark">Unlock Iris</h1>
        <p className="mt-1.5 text-muted text-sm text-center max-w-xs">
          Enter your password to unlock your encrypted messages
          {me ? <> as <span className="font-semibold text-navy">{me}</span></> : null}.
        </p>
      </div>

      <form
        onSubmit={submit}
        className="iris-rise relative z-10 w-full max-w-sm bg-card border border-muted-soft/40 rounded-3xl shadow-sm p-6 flex flex-col gap-3"
        style={{ animationDelay: "0.14s" }}
      >
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
            <LockIcon className="w-5 h-5" />
          </span>
          <input
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            required
            autoFocus
            autoComplete="current-password"
            className="w-full pl-10 pr-10 py-2.5 bg-bg border border-muted-soft rounded-xl text-navy placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-navy p-1"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOffIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
          </button>
        </div>

        <button
          type="submit"
          className="mt-1 bg-primary hover:bg-primary-hover text-white font-bold py-2.5 rounded-xl transition-transform active:scale-[0.98]"
        >
          Unlock
        </button>

        {error && <p className="text-red-600 text-sm text-center">{error}</p>}

        <button
          type="button"
          onClick={onLogout}
          className="text-muted hover:text-navy text-sm font-medium mt-1"
        >
          Log out
        </button>
      </form>
    </div>
  );
}
