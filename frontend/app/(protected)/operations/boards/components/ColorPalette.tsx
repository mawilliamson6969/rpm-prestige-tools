"use client";

import styles from "./customization.module.css";

/**
 * Fixed 12-color Monday-style palette. Keep in sync with
 * backend/routes/mbCustomization.js ALLOWED_COLORS.
 */
export const PALETTE: Array<{ name: string; value: string }> = [
  { name: "Red", value: "#e2445c" },
  { name: "Orange", value: "#fdab3d" },
  { name: "Yellow", value: "#ffcb00" },
  { name: "Green", value: "#00c875" },
  { name: "Teal", value: "#00d4d4" },
  { name: "Blue", value: "#0086c0" },
  { name: "Indigo", value: "#5559df" },
  { name: "Purple", value: "#a25ddc" },
  { name: "Pink", value: "#ff5ac4" },
  { name: "Brown", value: "#7f5347" },
  { name: "Gray", value: "#c4c4c4" },
  { name: "Dark", value: "#333333" },
];

const VALID_VALUES = new Set(PALETTE.map((c) => c.value));

export function isPaletteColor(v: unknown): v is string {
  return typeof v === "string" && VALID_VALUES.has(v.toLowerCase());
}

export default function ColorPalette({
  value,
  onChange,
}: {
  value: string | null | undefined;
  onChange: (next: string) => void;
}) {
  const normalized = typeof value === "string" ? value.toLowerCase() : null;
  return (
    <div className={styles.palette} role="radiogroup" aria-label="Color">
      {PALETTE.map((c) => {
        const selected = normalized === c.value;
        return (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={c.name}
            title={c.name}
            className={`${styles.swatch} ${selected ? styles.swatchSelected : ""}`}
            style={{ background: c.value }}
            onClick={() => onChange(c.value)}
          >
            {selected ? <span className={styles.swatchCheck}>✓</span> : null}
          </button>
        );
      })}
    </div>
  );
}
