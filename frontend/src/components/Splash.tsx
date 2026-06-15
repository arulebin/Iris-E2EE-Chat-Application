import { IrisMark } from "./icons";

// Opening moment: the iris mark resolves out of its own concentric rings,
// then the wordmark rises in. One orchestrated beat — nothing more.
export function Splash() {
  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-8">
      <div className="iris-breathe relative flex items-center justify-center w-44 h-44">
        <span className="absolute inset-0 rounded-full border border-primary/15" />
        <span className="absolute inset-5 rounded-full border border-primary/25" />
        <span className="absolute inset-10 rounded-full border border-primary/40" />
        <IrisMark className="w-16 h-16" />
      </div>
      <h1 className="iris-rise mt-10 text-4xl font-extrabold tracking-tight iris-wordmark">
        Iris
      </h1>
      <p className="iris-rise mt-2 text-muted text-sm">Private messages, end to end.</p>
    </div>
  );
}
