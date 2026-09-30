import { useId } from "react";

export function Logo({ className }: { className?: string }) {
  const gradient = useId();
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${gradient})`} />
      <rect x="7.5" y="7" width="5" height="18" rx="2.5" fill="#fff" />
      <path d="M16 15.5L22.5 9" stroke="#fff" strokeWidth="5" strokeLinecap="round" fill="none" />
      <path d="M16 16.5L19.5 20" stroke="#fff" strokeOpacity=".55" strokeWidth="5" strokeLinecap="round" fill="none" />
      <rect x="21.5" y="21.5" width="4.5" height="4.5" rx="1.3" fill="#22d3ee" />
    </svg>
  );
}
