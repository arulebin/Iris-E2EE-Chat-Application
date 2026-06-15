import { useState } from "react";
import { IrisMark, UserIcon, LockIcon, EyeIcon, EyeOffIcon } from "./icons";

type Props = {
  mode: "login" | "signup";
  username: string;
  password: string;
  error: string | null;
  onUsernameChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onModeChange: (next: "login" | "signup") => void;
};

export function AuthView({
  mode,
  username,
  password,
  error,
  onUsernameChange,
  onPasswordChange,
  onSubmit,
  onModeChange,
}: Props) {
  const [showPassword, setShowPassword] = useState(false);
  const isLogin = mode === "login";

  return (
    <div className="relative min-h-dvh overflow-hidden bg-bg flex flex-col items-center justify-center px-6">
      {/* Ambient aperture — the same iris motif as the splash, dropped behind
          the form so logging in feels like stepping through it. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
        <div className="relative mt-[-22vh] w-[150vw] max-w-[640px] aspect-square">
          <span className="absolute inset-0 rounded-full border border-primary/10" />
          <span className="absolute inset-[13%] rounded-full border border-primary/10" />
          <span className="absolute inset-[26%] rounded-full border border-primary/[0.08]" />
          <span className="absolute inset-[39%] rounded-full border border-primary/[0.06]" />
        </div>
      </div>

      {/* Brand */}
      <div className="iris-rise relative z-10 flex flex-col items-center mb-7" style={{ animationDelay: "0.05s" }}>
        <IrisMark className="w-14 h-14" />
        <h1 className="mt-3 text-4xl font-extrabold tracking-tight iris-wordmark">Iris</h1>
        <p className="mt-1.5 text-muted text-sm">Private messages, end to end.</p>
      </div>

      {/* Card */}
      <div
        className="iris-rise relative z-10 w-full max-w-sm bg-card border border-muted-soft/40 rounded-3xl shadow-sm p-6"
        style={{ animationDelay: "0.14s" }}
      >
        {/* Mode toggle — same segmented pill used elsewhere in the app */}
        <div className="bg-muted-soft/30 rounded-full p-1 flex mb-5">
          <button
            type="button"
            onClick={() => onModeChange("login")}
            className={`flex-1 py-2 text-sm font-bold rounded-full transition ${
              isLogin ? "bg-card text-navy shadow-sm" : "text-muted"
            }`}
          >
            Log in
          </button>
          <button
            type="button"
            onClick={() => onModeChange("signup")}
            className={`flex-1 py-2 text-sm font-bold rounded-full transition ${
              !isLogin ? "bg-card text-navy shadow-sm" : "text-muted"
            }`}
          >
            Sign up
          </button>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
              <UserIcon className="w-5 h-5" />
            </span>
            <input
              type="text"
              value={username}
              onChange={(e) => onUsernameChange(e.target.value)}
              placeholder="Username"
              required
              autoFocus
              autoComplete="username"
              className="w-full pl-10 pr-3 py-2.5 bg-bg border border-muted-soft rounded-xl text-navy placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition"
            />
          </div>

          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
              <LockIcon className="w-5 h-5" />
            </span>
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              placeholder="Password"
              required
              autoComplete={isLogin ? "current-password" : "new-password"}
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
            {isLogin ? "Log in" : "Create account"}
          </button>
        </form>

        {error && <p className="text-red-600 text-sm mt-3 text-center">{error}</p>}
      </div>

      {/* Trust line — the reason this product exists, stated plainly */}
      <div
        className="iris-rise relative z-10 mt-6 flex items-center gap-1.5 text-muted"
        style={{ animationDelay: "0.22s" }}
      >
        <LockIcon className="w-3.5 h-3.5" />
        <span className="text-[11px] font-medium">End-to-end encrypted · self-hosted</span>
      </div>
    </div>
  );
}
