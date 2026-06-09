"use client";

import { useEffect, useState } from "react";
import styles from "./operations.module.css";
import { apiUrl } from "../../../lib/api";
import { useAuth } from "../../../context/AuthContext";

type CreatedTemplate = {
  id: number;
  slug?: string | null;
  name: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (template: CreatedTemplate) => void;
};

// Categories match the set hardcoded in the legacy templates page so a
// process created here lands in the same buckets the rest of the UI
// expects.
const PROCESS_CATEGORIES = [
  "Owner Relations",
  "Leasing",
  "Maintenance",
  "Operations",
  "Admin",
  "Marketing",
  "Finance",
  "Other",
];

const PROCESS_ICONS = ["📋", "🔄", "🏠", "🛠️", "📈", "📨", "💰", "🧭", "📝", "🚪", "📁"];

const PROCESS_COLORS = [
  "#0098D0",
  "#1B2856",
  "#E63946",
  "#F2A93B",
  "#2A9D8F",
  "#7A52CC",
  "#0F766E",
  "#475569",
];

export default function CreateProcessModal({ open, onClose, onCreated }: Props) {
  const { authHeaders } = useAuth();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Operations");
  const [icon, setIcon] = useState("📋");
  const [color, setColor] = useState("#0098D0");
  const [estimatedDays, setEstimatedDays] = useState("14");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setCategory("Operations");
    setIcon("📋");
    setColor("#0098D0");
    setEstimatedDays("14");
    setErr(null);
  }, [open]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErr("Name is required.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl("/processes/templates"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          category,
          icon,
          color,
          estimatedDays: Number(estimatedDays) || 14,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof body.error === "string" ? body.error : "Could not create process."
        );
      }
      onCreated(body.template);
      onClose();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Could not create process.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={`${styles.modal} ${styles.modalWide}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2>New Process</h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <form className={styles.form} onSubmit={submit}>
          {err ? <div className={styles.errorBanner}>{err}</div> : null}
          <div className={styles.field}>
            <label>Process name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Move-Out Inspection"
              autoFocus
              required
            />
          </div>
          <div className={styles.field}>
            <label>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="One or two sentences on what this process does."
            />
          </div>
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label>Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {PROCESS_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label>Typical days to complete</label>
              <input
                type="number"
                min={1}
                max={365}
                value={estimatedDays}
                onChange={(e) => setEstimatedDays(e.target.value)}
              />
            </div>
          </div>
          <div className={styles.field}>
            <label>Icon</label>
            <div className={styles.iconPicker}>
              {PROCESS_ICONS.map((i) => (
                <button
                  key={i}
                  type="button"
                  className={`${styles.iconPickerBtn} ${
                    i === icon ? styles.iconPickerBtnActive : ""
                  }`}
                  onClick={() => setIcon(i)}
                >
                  {i}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.field}>
            <label>Color</label>
            <div className={styles.colorPicker}>
              {PROCESS_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  style={{ background: c }}
                  className={`${styles.colorPickerBtn} ${
                    c === color ? styles.colorPickerBtnActive : ""
                  }`}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
          <div className={styles.modalFooter}>
            <button type="button" className={styles.btn} onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className={`${styles.btn} ${styles.btnPrimary}`}
              disabled={saving}
            >
              {saving ? "Creating…" : "Create Process"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
