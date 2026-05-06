"use client";

import { useState } from "react";
import sidebarStyles from "../../app/(protected)/inbox/inbox.module.css";
import type { SavedView } from "../../hooks/inbox/useSavedViews";

type Props = {
  views: SavedView[];
  loading: boolean;
  selectedViewId: number | null;
  isAdmin: boolean;
  currentUserId: number | null;
  onApply: (view: SavedView) => void;
  onSaveCurrent: () => void;
  onDelete: (view: SavedView) => Promise<void>;
};

const SECTION_HEADER: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0.6rem 1rem 0.35rem",
  fontSize: "0.72rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "var(--grey, #6a737b)",
};

const SAVE_BTN: React.CSSProperties = {
  fontSize: "1.1rem",
  lineHeight: 1,
  padding: "0 0.35rem",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  color: "var(--grey, #6a737b)",
};

const ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  width: "100%",
  padding: "0.4rem 1rem",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  textAlign: "left",
  fontSize: "0.88rem",
  color: "var(--navy, #1b2856)",
};

const ROW_ACTIVE: React.CSSProperties = {
  ...ROW,
  background: "rgba(0, 152, 208, 0.12)",
  color: "var(--blue, #0098D0)",
  fontWeight: 600,
};

const COUNT_BADGE: React.CSSProperties = {
  marginLeft: "auto",
  fontSize: "0.75rem",
  color: "var(--grey, #6a737b)",
  fontVariantNumeric: "tabular-nums",
};

const REMOVE_BTN: React.CSSProperties = {
  background: "transparent",
  border: "none",
  cursor: "pointer",
  color: "var(--grey, #6a737b)",
  fontSize: "1rem",
  lineHeight: 1,
  padding: 0,
  marginLeft: "0.25rem",
  opacity: 0.6,
};

function canDelete(v: SavedView, isAdmin: boolean, currentUserId: number | null) {
  if (v.is_shared) return isAdmin;
  return v.owner_id != null && v.owner_id === currentUserId;
}

export default function ViewsSection({
  views,
  loading,
  selectedViewId,
  isAdmin,
  currentUserId,
  onApply,
  onSaveCurrent,
  onDelete,
}: Props) {
  const [hoverId, setHoverId] = useState<number | null>(null);

  return (
    <div>
      <div style={SECTION_HEADER}>
        <span>Views</span>
        <button type="button" style={SAVE_BTN} title="Save current filters as a view" onClick={onSaveCurrent}>
          +
        </button>
      </div>
      {loading && views.length === 0 ? (
        <div style={{ padding: "0.4rem 1rem", color: "var(--grey, #6a737b)", fontSize: "0.85rem" }}>
          Loading…
        </div>
      ) : null}
      {!loading && views.length === 0 ? (
        <div style={{ padding: "0.4rem 1rem", color: "var(--grey, #6a737b)", fontSize: "0.85rem" }}>
          No saved views yet.
        </div>
      ) : null}
      {views.map((v) => {
        const active = selectedViewId === v.id;
        const allowDelete = canDelete(v, isAdmin, currentUserId);
        return (
          <div
            key={v.id}
            onMouseEnter={() => setHoverId(v.id)}
            onMouseLeave={() => setHoverId((id) => (id === v.id ? null : id))}
            style={{ position: "relative", display: "flex", alignItems: "stretch" }}
          >
            <button
              type="button"
              style={active ? ROW_ACTIVE : ROW}
              onClick={() => onApply(v)}
              title={v.is_shared ? "Shared view" : "Personal view"}
            >
              {v.icon ? <span aria-hidden>{v.icon}</span> : <span aria-hidden style={{ width: "1.2em" }} />}
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {v.name}
              </span>
              {v.open_count != null ? <span style={COUNT_BADGE}>{v.open_count}</span> : null}
            </button>
            {allowDelete && hoverId === v.id ? (
              <button
                type="button"
                style={{ ...REMOVE_BTN, position: "absolute", right: "0.45rem", top: "50%", transform: "translateY(-50%)" }}
                aria-label={`Delete view ${v.name}`}
                title="Delete view"
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`Delete the "${v.name}" view?`)) void onDelete(v);
                }}
              >
                ×
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
