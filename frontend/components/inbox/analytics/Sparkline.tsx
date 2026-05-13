"use client";

// Inline sparkline for KPI tiles. Renders a tiny SVG polyline of the last
// 14 daily values. Auto-scales to the local max.

export default function Sparkline({
  data,
  color = "var(--accent)",
}: {
  data: number[] | null | undefined;
  color?: string;
}) {
  if (!data || data.length === 0) {
    return <svg viewBox="0 0 100 24" style={{ width: "100%", height: 24 }} aria-hidden />;
  }
  const max = Math.max(...data, 1);
  const points = data.map((v, i) => {
    const x = data.length === 1 ? 50 : (i / (data.length - 1)) * 100;
    const y = 24 - (v / max) * 22 - 1;
    return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  return (
    <svg
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      style={{ width: "100%", height: 24 }}
      aria-hidden
    >
      <path
        d={points.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
