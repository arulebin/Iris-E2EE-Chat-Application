type Props = {
  name: string;
  avatarUrl?: string;
  online?: boolean;
  size?: "sm" | "md" | "lg";
};

const SIZE_CLASSES: Record<NonNullable<Props["size"]>, string> = {
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-12 h-12 text-base",
};

const DOT_CLASSES: Record<NonNullable<Props["size"]>, string> = {
  sm: "w-2 h-2 right-0 top-0",
  md: "w-2.5 h-2.5 right-0 top-0",
  lg: "w-3 h-3 right-0 top-0",
};

// Deterministic avatar color from the username so a given user always looks the same.
function colorForName(name: string): string {
  const palette = [
    "bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-pink-500",
    "bg-purple-500", "bg-teal-500", "bg-rose-500", "bg-indigo-500",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

export function Avatar({ name, avatarUrl, online = false, size = "md" }: Props) {
  const initial = (name[0] ?? "?").toUpperCase();
  return (
    <div className="relative inline-block shrink-0">
      <div
        className={`${SIZE_CLASSES[size]} ${avatarUrl ? 'bg-transparent' : colorForName(name)} rounded-full flex items-center justify-center text-white font-bold overflow-hidden`}
      >
        {avatarUrl ? (
          <img src={avatarUrl.startsWith('http') ? avatarUrl : `/api/media/profile/${avatarUrl}`} alt={name} className="w-full h-full object-cover" />
        ) : (
          initial
        )}
      </div>
      {online && (
        <span
          className={`absolute ${DOT_CLASSES[size]} bg-online border-2 border-bg rounded-full`}
        />
      )}
    </div>
  );
}
