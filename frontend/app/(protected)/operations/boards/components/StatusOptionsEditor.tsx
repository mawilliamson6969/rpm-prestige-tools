"use client";

import { useState } from "react";
import styles from "./customization.module.css";
import ColorPalette, { isPaletteColor, PALETTE } from "./ColorPalette";
import type { StatusOption } from "@/types/mb";

const MAX_OPTIONS = 20;

/**
 * Manages a status / dropdown column's options list. All edits are
 * staged in local state and surfaced through onChange; the parent is
 * responsible for persisting them (this component never talks to the
 * API directly — keeps it reusable for add-column-with-options).
 *
 * When creating a brand-new column, options have no stable `value` yet;
 * the backend assigns one on save. For existing options, `value` is
 * preserved across rename/recolor.
 */
export default function StatusOptionsEditor({
  options,
  onChange,
  onDeleteRequest,
  disabled,
}: {
  options: StatusOption[];
  onChange: (next: StatusOption[]) => void;
  /**
   * If the caller wants delete to go through the API (for already-saved
   * options), they pass an async handler here. If not provided, delete
   * just mutates local state (used when creating a new column).
   */
  onDeleteRequest?: (option: StatusOption, idx: number) => void;
  disabled?: boolean;
}) {
  const [pickerOpenIdx, setPickerOpenIdx] = useState<number | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState<string>(PALETTE[0].value);

  function updateAt(idx: number, patch: Partial<StatusOption>) {
    onChange(options.map((o, i) => (i === idx ? { ...o, ...patch } : o)));
  }

  function removeAt(idx: number) {
    if (onDeleteRequest) {
      onDeleteRequest(options[idx], idx);
      return;
    }
    onChange(options.filter((_, i) => i !== idx));
  }

  function addOption() {
    const label = newLabel.trim();
    if (!label) return;
    if (options.length >= MAX_OPTIONS) return;
    if (options.some((o) => o.label.toLowerCase() === label.toLowerCase())) return;
    const color = isPaletteColor(newColor) ? newColor : PALETTE[0].value;
    onChange([...options, { label, value: "", color }]);
    setNewLabel("");
  }

  return (
    <div>
      {options.length === 0 ? (
        <div className={styles.rowMeta} style={{ marginBottom: "0.5rem" }}>
          No options yet — add one below.
        </div>
      ) : null}

      {options.map((o, idx) => (
        <div key={`${o.value || idx}-${o.label}`} className={styles.optionRow}>
          <button
            type="button"
            className={styles.colorDotBtn}
            style={{ background: o.color ?? PALETTE[PALETTE.length - 2].value }}
            aria-label="Change color"
            onClick={() =>
              setPickerOpenIdx(pickerOpenIdx === idx ? null : idx)
            }
            disabled={disabled}
          />
          <input
            type="text"
            className={styles.input}
            value={o.label}
            onChange={(e) => updateAt(idx, { label: e.target.value })}
            placeholder="Option label"
            disabled={disabled}
          />
          <button
            type="button"
            className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
            onClick={() => removeAt(idx)}
            aria-label={`Remove ${o.label}`}
            disabled={disabled}
          >
            ✕
          </button>
          {pickerOpenIdx === idx ? (
            <div className={styles.expandable} style={{ flexBasis: "100%" }}>
              <ColorPalette
                value={o.color}
                onChange={(c) => {
                  updateAt(idx, { color: c });
                  setPickerOpenIdx(null);
                }}
              />
            </div>
          ) : null}
        </div>
      ))}

      {options.length < MAX_OPTIONS ? (
        <div className={styles.addRow}>
          <button
            type="button"
            className={styles.colorDotBtn}
            style={{ background: newColor }}
            aria-label="Choose new option color"
            onClick={() => setPickerOpenIdx(pickerOpenIdx === -1 ? null : -1)}
            disabled={disabled}
          />
          <input
            type="text"
            className={styles.input}
            value={newLabel}
            placeholder="Add option…"
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addOption();
              }
            }}
            disabled={disabled}
          />
          <button
            type="button"
            className={styles.btnGhost}
            onClick={addOption}
            disabled={disabled || !newLabel.trim()}
          >
            Add
          </button>
        </div>
      ) : (
        <div className={styles.rowMeta} style={{ marginTop: "0.4rem" }}>
          Max {MAX_OPTIONS} options reached.
        </div>
      )}
      {pickerOpenIdx === -1 ? (
        <div className={styles.expandable}>
          <ColorPalette
            value={newColor}
            onChange={(c) => {
              setNewColor(c);
              setPickerOpenIdx(null);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
