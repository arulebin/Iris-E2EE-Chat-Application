// Stroke icons for the call UI (24px grid, currentColor).

type P = { className?: string };
const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const MicIcon = ({ off, className = "w-6 h-6" }: P & { off?: boolean }) => (
  <svg {...base} className={className}>
    {off ? (
      <>
        <line x1="1" x2="23" y1="1" y2="23" />
        <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
        <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.12 1.5-.35 2.18" />
        <line x1="12" x2="12" y1="19" y2="23" />
      </>
    ) : (
      <>
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" x2="12" y1="19" y2="22" />
      </>
    )}
  </svg>
);

export const CamIcon = ({ off, className = "w-6 h-6" }: P & { off?: boolean }) => (
  <svg {...base} className={className}>
    {off ? (
      <>
        <path d="M10.66 5H14a2 2 0 0 1 2 2v2.34l1 1L22 8v8" />
        <path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2l10 10Z" />
        <line x1="2" x2="22" y1="2" y2="22" />
      </>
    ) : (
      <>
        <path d="m22 8-6 4 6 4V8Z" />
        <rect width="14" height="12" x="2" y="6" rx="2" ry="2" />
      </>
    )}
  </svg>
);

export const FlipIcon = ({ className = "w-6 h-6" }: P) => (
  <svg {...base} className={className}>
    <path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
    <path d="M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5" />
    <circle cx="12" cy="12" r="3" />
    <path d="m18 22-3-3 3-3" />
    <path d="m6 2 3 3-3 3" />
  </svg>
);

export const SpeakerIcon = ({ on, className = "w-6 h-6" }: P & { on?: boolean }) => (
  <svg {...base} className={className}>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    {on ? (
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
    ) : (
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    )}
  </svg>
);

export const PhoneIcon = ({ className = "w-7 h-7", hangup }: P & { hangup?: boolean }) => (
  <svg {...base} className={className} style={hangup ? { transform: "rotate(135deg)" } : undefined}>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

export const ChevronDownIcon = ({ className = "w-6 h-6" }: P) => (
  <svg {...base} className={className}><path d="m6 9 6 6 6-6" /></svg>
);

export const PipIcon = ({ className = "w-5 h-5" }: P) => (
  <svg {...base} className={className}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <rect x="12" y="11" width="7" height="6" rx="1" />
  </svg>
);

export const LockIcon = ({ className = "w-3.5 h-3.5" }: P) => (
  <svg {...base} className={className}>
    <rect width="18" height="11" x="3" y="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

export const XIcon = ({ className = "w-6 h-6" }: P) => (
  <svg {...base} className={className}><path d="M18 6 6 18M6 6l12 12" /></svg>
);
