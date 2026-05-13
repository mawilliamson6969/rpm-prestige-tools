"use client";

// Channel mix donut — ports the design's ChannelDonut helper.

import styles from "./analytics.module.css";
import type { ChannelSlice } from "../../../hooks/inbox/useAnalytics";

const CHANNEL_LABEL: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  whatsapp: "WhatsApp",
  voicemail: "Voicemail",
  webchat: "Web chat",
};

const CHANNEL_TINT: Record<string, string> = {
  email: "var(--accent)",
  sms: "#0098D0",
  whatsapp: "#1F8A5B",
  voicemail: "#B45309",
  webchat: "#7A5AE0",
};

export default function ChannelDonut({
  total,
  channels,
}: {
  total: number;
  channels: ChannelSlice[];
}) {
  if (!channels.length || total === 0) {
    return (
      <div style={{ color: "var(--text-3)", fontSize: 12, padding: "20px 0" }}>
        No traffic in this window.
      </div>
    );
  }

  const R = 60;
  const r = 38;
  const cx = 80;
  const cy = 80;
  let acc = 0;
  const segs = channels.map((d) => {
    const start = (acc / total) * Math.PI * 2 - Math.PI / 2;
    acc += d.count;
    const end = (acc / total) * Math.PI * 2 - Math.PI / 2;
    const large = end - start > Math.PI ? 1 : 0;
    const sx = cx + Math.cos(start) * R;
    const sy = cy + Math.sin(start) * R;
    const ex = cx + Math.cos(end) * R;
    const ey = cy + Math.sin(end) * R;
    const sx2 = cx + Math.cos(end) * r;
    const sy2 = cy + Math.sin(end) * r;
    const ex2 = cx + Math.cos(start) * r;
    const ey2 = cy + Math.sin(start) * r;
    // Full-circle edge case (single slice = 100%): close as two halves.
    if (channels.length === 1) {
      const half = (start + end) / 2;
      const mx = cx + Math.cos(half) * R;
      const my = cy + Math.sin(half) * R;
      const mx2 = cx + Math.cos(half) * r;
      const my2 = cy + Math.sin(half) * r;
      const path =
        `M ${sx} ${sy} A ${R} ${R} 0 1 1 ${mx} ${my} A ${R} ${R} 0 1 1 ${ex} ${ey} ` +
        `L ${ex2} ${ey2} A ${r} ${r} 0 1 0 ${mx2} ${my2} A ${r} ${r} 0 1 0 ${sx2} ${sy2} Z`;
      return { path, tint: CHANNEL_TINT[d.channel] || "var(--text-3)" };
    }
    const path = `M ${sx} ${sy} A ${R} ${R} 0 ${large} 1 ${ex} ${ey} L ${sx2} ${sy2} A ${r} ${r} 0 ${large} 0 ${ex2} ${ey2} Z`;
    return { path, tint: CHANNEL_TINT[d.channel] || "var(--text-3)" };
  });

  return (
    <div className={styles.donutWrap}>
      <svg viewBox="0 0 160 160" style={{ width: 140, height: 140, flexShrink: 0 }}>
        {segs.map((s, i) => (
          <path key={i} d={s.path} fill={s.tint} />
        ))}
        <text
          x="80"
          y="78"
          textAnchor="middle"
          fontSize="22"
          fontWeight="600"
          fill="#0F172A"
          fontFamily="inherit"
        >
          {total}
        </text>
        <text x="80" y="94" textAnchor="middle" fontSize="10" fill="#94A3B8" fontFamily="inherit">
          conversations
        </text>
      </svg>
      <div className={styles.donutLegend}>
        {channels.map((d) => (
          <div key={d.channel} className={styles.donutLegendRow}>
            <span
              className={styles.donutLegendSwatch}
              style={{ background: CHANNEL_TINT[d.channel] || "var(--text-3)" }}
            />
            <span className={styles.donutLegendLabel}>
              {CHANNEL_LABEL[d.channel] || d.channel}
            </span>
            <span className={styles.donutLegendValue}>{d.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
