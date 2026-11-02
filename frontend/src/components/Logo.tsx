export function Logo({ className }: { className?: string }) {
  // "लि" (li, from lipi = script) under a sindoor headline: the script and the bridge over it.
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#2a231d" />
      <rect x="0.5" y="0.5" width="63" height="63" rx="15.5" fill="none" stroke="rgb(255 255 255 / 0.08)" />
      <text
        x="32"
        y="47"
        textAnchor="middle"
        fontFamily="'Noto Serif Devanagari', 'Nirmala UI', serif"
        fontSize="34"
        fontWeight="600"
        fill="#f3ece0"
      >
        लि
      </text>
      <path d="M11 19.5h42" stroke="#d2603f" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}
