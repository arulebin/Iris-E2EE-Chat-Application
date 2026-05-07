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
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm bg-card border border-muted-soft/40 rounded-2xl shadow-sm p-8">
        <h1 className="text-3xl font-extrabold text-navy">Iris</h1>
        <p className="text-muted mb-6 text-sm">
          Private chat for you and your circle.
        </p>

        <h2 className="text-xl font-bold text-navy mb-4">
          {mode === "login" ? "Log in" : "Create account"}
        </h2>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            value={username}
            onChange={(e) => onUsernameChange(e.target.value)}
            placeholder="Username"
            required
            autoFocus
            className="px-3 py-2 border border-muted-soft rounded-lg text-navy placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            placeholder="Password"
            required
            className="px-3 py-2 border border-muted-soft rounded-lg text-navy placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            type="submit"
            className="bg-primary hover:bg-primary-hover text-white font-semibold py-2 rounded-lg transition"
          >
            {mode === "login" ? "Log in" : "Sign up"}
          </button>
        </form>

        {error && <p className="text-red-600 text-sm mt-3">{error}</p>}

        <p className="text-sm text-muted mt-6 text-center">
          {mode === "login" ? "No account? " : "Already have one? "}
          <button
            onClick={() => onModeChange(mode === "login" ? "signup" : "login")}
            className="text-primary hover:underline font-semibold"
          >
            {mode === "login" ? "Sign up" : "Log in"}
          </button>
        </p>
      </div>
    </div>
  );
}
