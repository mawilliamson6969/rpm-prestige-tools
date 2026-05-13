"use client";

import { useToast } from "../../hooks/inbox/useToast";

const VARIANT_BG: Record<string, string> = {
  info: "#1b2856",
  success: "#2e7d32",
  error: "#b32317",
};

export default function ToastContainer() {
  const { toasts, dismiss } = useToast();
  if (!toasts.length) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        right: "1rem",
        bottom: "1rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        zIndex: 1000,
        maxWidth: "min(20rem, 90vw)",
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            background: VARIANT_BG[t.variant] || VARIANT_BG.info,
            color: "#fff",
            padding: "0.65rem 0.85rem",
            borderRadius: 8,
            boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
            fontSize: "0.9rem",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <span style={{ flex: 1 }}>{t.message}</span>
          {t.retry ? (
            <button
              type="button"
              onClick={() => {
                t.retry?.();
                dismiss(t.id);
              }}
              style={{
                background: "rgba(255,255,255,0.18)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.4)",
                borderRadius: 6,
                padding: "0.2rem 0.55rem",
                fontSize: "0.8rem",
                cursor: "pointer",
              }}
            >
              Retry
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
            style={{
              background: "transparent",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontSize: "1rem",
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
