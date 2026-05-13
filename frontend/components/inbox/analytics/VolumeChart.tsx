"use client";

// Volume chart — two-line SVG (received solid + filled area, resolved
// dashed). Ports the design's VolumeChart helper from screens.jsx.

import type { VolumePoint } from "../../../hooks/inbox/useAnalytics";

const ACCENT = "var(--accent)";
const RESOLVED = "#1F8A5B";

const W = 600;
const H = 200;
const PAD_L = 36;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 28;

function niceMax(n: number): number {
  if (n <= 5) return 5;
  if (n <= 10) return 10;
  if (n <= 20) return 20;
  if (n <= 50) return 50;
  if (n <= 100) return 100;
  if (n <= 200) return 200;
  if (n <= 500) return 500;
  // Round up to the next 100.
  return Math.ceil(n / 100) * 100;
}

export default function VolumeChart({ data }: { data: VolumePoint[] }) {
  if (data.length === 0) {
    return (
      <div style={{ minHeight: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-3)", fontSize: 12 }}>
        No data in this window.
      </div>
    );
  }
  const peak = Math.max(...data.map((d) => Math.max(d.received, d.resolved)), 1);
  const max = niceMax(Math.ceil(peak * 1.15));
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const x = (i: number) =>
    PAD_L + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => PAD_T + innerH - (v / max) * innerH;
  const recvPath = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(d.received)}`)
    .join(" ");
  const resPath = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(d.resolved)}`)
    .join(" ");
  const recvArea = `${recvPath} L ${x(data.length - 1)} ${PAD_T + innerH} L ${x(0)} ${PAD_T + innerH} Z`;

  // Five-line y-grid.
  const yTicks: number[] = [];
  for (let i = 0; i <= 4; i++) yTicks.push(Math.round((max / 4) * i));

  // Label every Nth x-tick to keep things readable.
  const labelEvery = data.length > 30 ? Math.ceil(data.length / 10) : 2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
      <defs>
        <linearGradient id="volGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={ACCENT} stopOpacity="0.18" />
          <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
        </linearGradient>
      </defs>
      {yTicks.map((v) => (
        <g key={v}>
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={y(v)}
            y2={y(v)}
            stroke="#ECEEF2"
            strokeWidth="1"
          />
          <text
            x={PAD_L - 6}
            y={y(v) + 3}
            textAnchor="end"
            fontSize="9.5"
            fill="#94A3B8"
            fontFamily="inherit"
          >
            {v}
          </text>
        </g>
      ))}
      <path d={recvArea} fill="url(#volGrad)" />
      <path
        d={recvPath}
        fill="none"
        stroke={ACCENT}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={resPath}
        fill="none"
        stroke={RESOLVED}
        strokeWidth="1.5"
        strokeDasharray="4 3"
        strokeLinecap="round"
      />
      {data.map((d, i) =>
        i % labelEvery === 0 ? (
          <text
            key={d.date}
            x={x(i)}
            y={H - 8}
            textAnchor="middle"
            fontSize="9.5"
            fill="#94A3B8"
            fontFamily="inherit"
          >
            {labelForDate(d.date)}
          </text>
        ) : null
      )}
      <circle
        cx={x(data.length - 1)}
        cy={y(data[data.length - 1].received)}
        r="3.5"
        fill="#fff"
        stroke={ACCENT}
        strokeWidth="1.75"
      />
    </svg>
  );
}

function labelForDate(iso: string): string {
  // "YYYY-MM-DD" → "MMM D"
  const d = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
