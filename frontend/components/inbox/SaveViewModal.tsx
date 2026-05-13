"use client";

import { useEffect, useState } from "react";
import type { SavedViewFilters } from "../../hooks/inbox/useSavedViews";

type Props = {
  open: boolean;
  isAdmin: boolean;
  defaultName?: string;
  initialFilters: SavedViewFilters;
  onClose: () => void;
  onSave: (input: {
    name: string;
    icon?: string | null;
    is_shared?: boolean;
  }) => Promise<void>;
};

const OVERLAY: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(27, 40, 86, 0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1100,
};

const MODAL: React.CSSProperties = {
  background: "#fff",
  borderRadius: 10,
  width: "min(420px, 92vw)",
  padding: "1.25rem",
  boxShadow: "0 10px 32px rgba(0,0,0,0.2)",
};

const FIELD: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.3rem",
  marginBottom: "0.85rem",
};

function summarizeFilters(f: SavedViewFilters): string {
  const bits: string[] = [];
  if (f.bucket && f.bucket !== "all" && f.bucket !== "open") bits.push(f.bucket);
  if (f.status) bits.push(f.status);
  if (f.category) bits.push(f.category);
  if (f.priority) bits.push(`priority=${f.priority}`);
  if (f.priority_in?.length) bits.push(`priority∈[${f.priority_in.join(",")}]`);
  if (f.assignedTo != null) bits.push(`assignee=#${f.assignedTo}`);
  if (f.assignedToMe) bits.push("mine");
  if (f.unassigned) bits.push("unassigned");
  if (f.starred) bits.push("starred");
  if (f.has_unread) bits.push("unread");
  if (f.sla_breached) bits.push("SLA breached");
  if (f.search) bits.push(`q="${f.search}"`);
  if (f.connectionId != null) bits.push(`mailbox=#${f.connectionId}`);
  return bits.length ? bits.join(" · ") : "no filters (matches everything)";
}

export default function SaveViewModal({
  open,
  isAdmin,
  defaultName,
  initialFilters,
  onClose,
  onSave,
}: Props) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [shared, setShared] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(defaultName?.trim() || "");
    setIcon("");
    setShared(false);
    setError(null);
  }, [open, defaultName]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    setSubmitting(true);
    try {
      await onSave({ name: trimmed, icon: icon.trim() || null, is_shared: shared });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save view.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={OVERLAY} role="dialog" aria-modal="true" onClick={onClose}>
      <div style={MODAL} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: "0 0 0.6rem", color: "#1b2856" }}>Save view</h2>
        <p style={{ margin: "0 0 0.85rem", color: "#6a737b", fontSize: "0.85rem" }}>
          Filters: {summarizeFilters(initialFilters)}
        </p>
        <form onSubmit={handleSubmit}>
          <label style={FIELD}>
            <span style={{ fontSize: "0.85rem", color: "#6a737b" }}>Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
              style={{ padding: "0.45rem", border: "1px solid #cfd4dc", borderRadius: 6 }}
            />
          </label>
          <label style={FIELD}>
            <span style={{ fontSize: "0.85rem", color: "#6a737b" }}>Icon (emoji, optional)</span>
            <input
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              maxLength={4}
              style={{ padding: "0.45rem", border: "1px solid #cfd4dc", borderRadius: 6, width: "5rem" }}
            />
          </label>
          {isAdmin ? (
            <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.85rem" }}>
              <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
              <span style={{ fontSize: "0.88rem" }}>Share with the team</span>
            </label>
          ) : null}
          {error ? (
            <div style={{ color: "#b32317", fontSize: "0.85rem", marginBottom: "0.5rem" }} role="alert">
              {error}
            </div>
          ) : null}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={{
                padding: "0.4rem 0.9rem",
                border: "1px solid #cfd4dc",
                borderRadius: 6,
                background: "#fff",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={{
                padding: "0.4rem 0.9rem",
                border: "none",
                borderRadius: 6,
                background: "#1b2856",
                color: "#fff",
                cursor: submitting ? "not-allowed" : "pointer",
              }}
            >
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
