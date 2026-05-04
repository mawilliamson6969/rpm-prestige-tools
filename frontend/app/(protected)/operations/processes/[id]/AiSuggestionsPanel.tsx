"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../../operations.module.css";
import { apiUrl } from "../../../../../lib/api";
import { useAuth } from "../../../../../context/AuthContext";
import type { AiSuggestion } from "../../types";

const TYPE_LABELS: Record<string, string> = {
  follow_up: "Follow-up",
  escalate: "Escalation",
  reassign: "Reassignment",
  auto_create: "Auto-create",
  reminder: "Reminder",
  insight: "Insight",
};

type Props = {
  processId: number;
  onAction?: (action: AppliedAction) => void;
};

export type AppliedAction =
  | {
      action: "open_email_composer";
      processId: number;
      prefill: { recipientType: string; subject: string; body: string };
    }
  | {
      action: "open_text_composer";
      processId: number;
      prefill: { recipientType: string; body: string };
    }
  | { action: "stage_changed"; stageId: number; stageName: string }
  | { action: "reassigned"; toUserId: number; toUserName: string; stepsTouched: number }
  | { action: "stage_not_found"; suggestedStage?: string }
  | { action: "user_not_found"; suggestedUser?: string }
  | { action: "prompt_create_process"; templateName: string | null; reason: string | null }
  | { action: "no_action" }
  | { action: "error"; error: string };

export default function AiSuggestionsPanel({ processId, onAction }: Props) {
  const { authHeaders, token } = useAuth();
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl(`/processes/${processId}/suggestions`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body.suggestions)) setSuggestions(body.suggestions);
    } catch {
      /* ignore */
    }
  }, [authHeaders, token, processId]);

  useEffect(() => {
    load();
  }, [load]);

  const apply = async (s: AiSuggestion) => {
    setBusyId(s.id);
    setErr(null);
    try {
      const res = await fetch(
        apiUrl(`/processes/process-suggestions/${s.id}/accept`),
        { method: "PUT", headers: { ...authHeaders() } }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Apply failed");
      onAction?.(body as AppliedAction);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Apply failed.");
    } finally {
      setBusyId(null);
    }
  };

  const dismiss = async (s: AiSuggestion) => {
    setBusyId(s.id);
    try {
      await fetch(apiUrl(`/processes/process-suggestions/${s.id}/dismiss`), {
        method: "PUT",
        headers: { ...authHeaders() },
      });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  if (suggestions.length === 0) return null;

  const visible = showAll ? suggestions : suggestions.slice(0, 3);

  return (
    <div style={{ marginBottom: "1.25rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      {err ? <div className={styles.errorBanner}>{err}</div> : null}
      {visible.map((s) => {
        const conf = s.confidence != null ? Math.round(s.confidence * 100) : null;
        const typeLabel = TYPE_LABELS[s.suggestionType] || s.suggestionType;
        return (
          <div
            key={s.id}
            style={{
              background:
                "linear-gradient(135deg, #F3E8FF 0%, #E8F4FD 50%, #F0FFF4 100%)",
              border: "1px solid rgba(108, 92, 246, 0.25)",
              borderRadius: 10,
              padding: "0.85rem 1rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.4rem",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                fontSize: "0.72rem",
                fontWeight: 700,
                color: "#6C5CE7",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              <span aria-hidden>✨</span> AI suggestion · {typeLabel}
              {conf != null ? (
                <span
                  style={{
                    marginLeft: "auto",
                    background: "rgba(108, 92, 246, 0.15)",
                    color: "#6C5CE7",
                    padding: "0.1rem 0.45rem",
                    borderRadius: 999,
                    fontSize: "0.66rem",
                  }}
                >
                  {conf}%
                </span>
              ) : null}
            </div>
            <div style={{ color: "#1B2856", fontWeight: 700, fontSize: "0.95rem" }}>
              {s.title}
            </div>
            <div style={{ color: "#1B2856", fontSize: "0.85rem", lineHeight: 1.45 }}>
              {s.description}
            </div>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.2rem" }}>
              <button
                type="button"
                onClick={() => apply(s)}
                disabled={busyId === s.id}
                style={{
                  background: "#6C5CE7",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  padding: "0.4rem 0.9rem",
                  fontSize: "0.82rem",
                  fontWeight: 700,
                  cursor: busyId === s.id ? "wait" : "pointer",
                }}
              >
                {busyId === s.id ? "Working…" : "Apply"}
              </button>
              <button
                type="button"
                onClick={() => dismiss(s)}
                disabled={busyId === s.id}
                style={{
                  background: "transparent",
                  color: "#6C5CE7",
                  border: "1px solid rgba(108, 92, 246, 0.4)",
                  borderRadius: 6,
                  padding: "0.4rem 0.9rem",
                  fontSize: "0.82rem",
                  fontWeight: 600,
                  cursor: busyId === s.id ? "wait" : "pointer",
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        );
      })}
      {suggestions.length > 3 ? (
        <button
          type="button"
          className={styles.smallBtn}
          style={{ alignSelf: "flex-start" }}
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? "Hide" : `Show ${suggestions.length - 3} more`}
        </button>
      ) : null}
    </div>
  );
}
