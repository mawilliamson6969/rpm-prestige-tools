"use client";

// Small SVG icon set used by the inbox shell sidebar.
// Stroke icons match the visual weight of the design handoff (1.6–1.8px
// stroke at 16px).

type IconProps = { size?: number; className?: string };

const stroke = "currentColor";

export function InboxIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M3 13l3-8h12l3 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6Z" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M3 13h5l1.5 2h5L16 13h5" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function UserIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <circle cx="12" cy="8" r="3.5" stroke={stroke} strokeWidth="1.6" />
      <path d="M4.5 20c1-3.5 4.2-5.5 7.5-5.5s6.5 2 7.5 5.5" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function AtIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <circle cx="12" cy="12" r="4" stroke={stroke} strokeWidth="1.6" />
      <path d="M16 8v5a3 3 0 0 0 5-2.4 9 9 0 1 0-3.6 7.2" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function PaperIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M14 3v4h4" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function ClockIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <circle cx="12" cy="12" r="8.5" stroke={stroke} strokeWidth="1.6" />
      <path d="M12 7.5V12l3 2" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function StarIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="m12 3.5 2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17.4 6.6 20.3l1-6.1L3.2 9.9l6.1-.9L12 3.5Z" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function FolderIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M3 7a2 2 0 0 1 2-2h4.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function BarIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M4 20V4M4 20h16" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
      <rect x="7" y="11" width="3" height="6" stroke={stroke} strokeWidth="1.6" />
      <rect x="12" y="7" width="3" height="10" stroke={stroke} strokeWidth="1.6" />
      <rect x="17" y="13" width="3" height="4" stroke={stroke} strokeWidth="1.6" />
    </svg>
  );
}

export function BoltIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M13 3 4 14h6l-1 7 9-11h-6l1-7Z" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function CogIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <circle cx="12" cy="12" r="3" stroke={stroke} strokeWidth="1.6" />
      <path
        d="M19.4 13.4a1.6 1.6 0 0 1 .4 1.7l-.5.9a1.6 1.6 0 0 1-1.5.8l-1-.1a7 7 0 0 1-1.8 1l-.3 1a1.6 1.6 0 0 1-1.6 1.2h-1.2a1.6 1.6 0 0 1-1.6-1.2l-.3-1a7 7 0 0 1-1.8-1l-1 .1a1.6 1.6 0 0 1-1.5-.8l-.5-.9a1.6 1.6 0 0 1 .4-1.7l.7-.7a7 7 0 0 1 0-2l-.7-.7a1.6 1.6 0 0 1-.4-1.7l.5-.9a1.6 1.6 0 0 1 1.5-.8l1 .1a7 7 0 0 1 1.8-1l.3-1A1.6 1.6 0 0 1 11.4 4h1.2a1.6 1.6 0 0 1 1.6 1.2l.3 1c.7.3 1.3.6 1.8 1l1-.1a1.6 1.6 0 0 1 1.5.8l.5.9a1.6 1.6 0 0 1-.4 1.7l-.7.7a7 7 0 0 1 0 2l.7.7Z"
        stroke={stroke}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SearchIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <circle cx="11" cy="11" r="6.5" stroke={stroke} strokeWidth="1.6" />
      <path d="m20 20-4-4" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function EditIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M4 20h4l10-10-4-4L4 16v4Z" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="m13 7 4 4" stroke={stroke} strokeWidth="1.6" />
    </svg>
  );
}

export function PlusIcon({ size = 12, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M12 5v14M5 12h14" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 12, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="m6 9 6 6 6-6" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronLeftIcon({ size = 12, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="m15 6-6 6 6 6" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 12, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="m9 6 6 6-6 6" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MenuIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h16" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
