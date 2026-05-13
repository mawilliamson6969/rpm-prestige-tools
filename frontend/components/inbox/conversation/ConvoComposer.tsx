"use client";

// Conversation composer — D0-aligned design.
// Wraps the existing useCompose / useAIDraft state in the new tabbed
// (Reply / Internal note / Forward) layout from the design. Forward is
// shown but disabled — no forward path exists yet.

import { useCallback, useRef, useState } from "react";
import styles from "./conversation.module.css";
import { sanitizeEmailHtml } from "../../../lib/sanitizeEmailHtml";
import type { ThreadRow } from "../../../hooks/inbox/types";
import type { UseAIDraft } from "../../../hooks/inbox/useAIDraft";
import type { UseCompose } from "../../../hooks/inbox/useCompose";
import type { UseThreadAutomations } from "../../../hooks/inbox/useThreadAutomations";
import type {
  AiSuggestionKind,
  UseAiSuggestions,
} from "../../../hooks/inbox/useAiSuggestions";
import { hasNoAiContext } from "../inboxConstants";

type Props = {
  thread: ThreadRow;
  compose: UseCompose;
  aiDraft: UseAIDraft;
  canReply: boolean;
  onRunAiDraft: () => void;
  onDismissAiDraft: () => void;
  onSend: () => void;
  /** Phase 4: rule-suggestion chips rendered above the footer. */
  automations?: UseThreadAutomations | null;
  /** Called after a suggestion is accepted (so the parent can refetch
   *  detail + stats and re-paint the banner / status / assignee). */
  onAutomationActed?: () => void | Promise<void>;
  /** Phase 6: AI follow-up suggestions for the "AI suggest" tab. */
  aiSuggestions?: UseAiSuggestions | null;
  /** Phase 6: handler invoked when an AI-suggest chip is clicked. */
  onAiSuggestionAction?: (s: { label: string; kind: AiSuggestionKind }) => void;
};

export default function ConvoComposer({
  thread,
  compose,
  aiDraft,
  canReply,
  onRunAiDraft,
  onDismissAiDraft,
  onSend,
  automations = null,
  onAutomationActed,
  aiSuggestions = null,
  onAiSuggestionAction,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isNote = compose.mode === "note";
  const allowAttachments = compose.mode === "reply" && canReply;
  const hasFiles = compose.attachments.length > 0;
  const sendDisabled = compose.sending || (!compose.body.trim() && !hasFiles);

  // Phase 6: "AI suggest" tab. We don't add a fourth compose.mode (that
  // would force every consumer to handle it); instead a local boolean
  // swaps the composer body for the chip picker. Reply/note state stays
  // intact underneath.
  const [aiTabOpen, setAiTabOpen] = useState(false);
  const onOpenAiTab = useCallback(() => {
    setAiTabOpen(true);
    if (aiSuggestions && aiSuggestions.suggestions.length === 0 && !aiSuggestions.loading) {
      void aiSuggestions.refresh(thread.thread_id);
    }
  }, [aiSuggestions, thread.thread_id]);

  const sigRow =
    compose.selectedSigId !== "none" && compose.selectedSigId !== null
      ? compose.signatures.find((s) => s.id === compose.selectedSigId)
      : undefined;
  const sigPreviewHtml = sigRow?.signatureHtml?.trim();
  const showSigPreview =
    compose.mode === "reply" &&
    compose.expanded &&
    compose.selectedSigId !== "none" &&
    compose.selectedSigId !== null &&
    !!sigPreviewHtml;

  // Drag-and-drop: a small dragging state drives the dashed-outline
  // highlight via [data-dragging] on .cvComposer. Counter pattern handles
  // child-dragenter without flicker.
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const onDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!allowAttachments || !e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    },
    [allowAttachments]
  );
  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!allowAttachments) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    [allowAttachments]
  );
  const onDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (!allowAttachments) return;
      e.preventDefault();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    },
    [allowAttachments]
  );
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      if (!allowAttachments) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const files = e.dataTransfer?.files;
      if (files && files.length) {
        compose.addAttachments(files);
        compose.setExpanded(true);
      }
    },
    [allowAttachments, compose]
  );

  return (
    <div
      className={styles.cvComposer}
      data-dragging={dragging ? "true" : "false"}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className={styles.cvCompTabs} role="tablist" aria-label="Composer mode">
        {canReply ? (
          <button
            type="button"
            role="tab"
            aria-selected={compose.mode === "reply"}
            data-active={compose.mode === "reply" ? "true" : "false"}
            className={styles.cvCompTab}
            onClick={() => compose.setMode("reply")}
          >
            ↩ Reply
          </button>
        ) : null}
        <button
          type="button"
          role="tab"
          aria-selected={isNote}
          data-active={isNote ? "true" : "false"}
          data-note={isNote ? "true" : "false"}
          className={styles.cvCompTab}
          onClick={() => compose.setMode("note")}
        >
          @ Internal note
        </button>
        <button
          type="button"
          role="tab"
          className={styles.cvCompTab}
          disabled
          title="Forward — coming in a later phase"
        >
          ⇒ Forward
        </button>
        {canReply ? (
          <button
            type="button"
            role="tab"
            aria-selected={aiTabOpen}
            data-active={aiTabOpen ? "true" : "false"}
            className={styles.cvCompTab}
            onClick={() => (aiTabOpen ? setAiTabOpen(false) : onOpenAiTab())}
            title="AI suggest follow-up actions"
          >
            ✨ AI suggest
          </button>
        ) : null}
        <span style={{ flex: 1 }} />
        {canReply && !aiTabOpen ? (
          <button
            type="button"
            className={styles.cvCompSuggest}
            onClick={onRunAiDraft}
            disabled={aiDraft.loading}
            title="Draft a reply with AI"
          >
            ✨ {aiDraft.loading ? "Drafting…" : "AI draft reply"}
          </button>
        ) : null}
      </div>

      {aiTabOpen ? (
        <AiSuggestPanel
          suggestions={aiSuggestions}
          threadId={thread.thread_id}
          onAction={onAiSuggestionAction}
          onClose={() => setAiTabOpen(false)}
        />
      ) : null}

      {aiTabOpen ? null : (
      <>
      {!canReply ? (
        <div
          style={{
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 12,
            color: "var(--text-3)",
            marginBottom: 8,
          }}
        >
          You have read-only access to this mailbox. Internal notes are still allowed.
        </div>
      ) : null}

      {aiDraft.bannerVisible && compose.mode === "reply" ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            background: "var(--selected)",
            border: "1px solid var(--ring)",
            borderRadius: 8,
            padding: "6px 10px",
            marginBottom: 8,
            fontSize: 12,
            color: "var(--text)",
          }}
        >
          <span>AI-drafted response — review and edit before sending.</span>
          <button
            type="button"
            onClick={onDismissAiDraft}
            style={{
              border: "none",
              background: "transparent",
              color: "var(--accent)",
              fontWeight: 600,
              cursor: "pointer",
              textDecoration: "underline",
              fontSize: 12,
              fontFamily: "inherit",
            }}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {aiDraft.bannerVisible && compose.mode === "reply" && aiDraft.contextUsed ? (
        <details
          style={{
            fontSize: 11.5,
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "6px 10px",
            background: "var(--panel-2)",
            marginBottom: 8,
          }}
        >
          <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--text)" }}>
            Context used
          </summary>
          {hasNoAiContext(aiDraft.contextUsed) ? (
            <p style={{ margin: "6px 0 0", color: "var(--text-3)" }}>No matching context found.</p>
          ) : (
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "var(--text-3)", lineHeight: 1.45 }}>
              <li>
                Property:{" "}
                {aiDraft.contextUsed.property
                  ? `✓ ${aiDraft.contextUsed.propertyName || thread.linked_property_name || "matched"}`
                  : "—"}
              </li>
              <li>
                Tenant:{" "}
                {aiDraft.contextUsed.tenant
                  ? `✓ ${aiDraft.contextUsed.tenantName || thread.linked_tenant_name || "matched"}`
                  : "—"}
              </li>
              <li>
                Owner:{" "}
                {aiDraft.contextUsed.owner
                  ? `✓ ${aiDraft.contextUsed.ownerName || thread.linked_owner_name || "matched"}`
                  : "—"}
              </li>
              <li>Work orders: {aiDraft.contextUsed.workOrders ?? 0} open</li>
              <li>
                Delinquency:{" "}
                {aiDraft.contextUsed.delinquency != null && aiDraft.contextUsed.delinquency !== ""
                  ? aiDraft.contextUsed.delinquency
                  : "—"}
              </li>
              <li>
                LeadSimple:{" "}
                {aiDraft.contextUsed.leadsimple ? "✓ open deals/tasks matched" : "—"}
              </li>
            </ul>
          )}
        </details>
      ) : null}

      {compose.mode === "reply" && canReply ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "8px 12px",
            marginBottom: 6,
          }}
        >
          <label
            htmlFor="convo-signature-select"
            style={{ fontSize: 12, fontWeight: 600, color: "var(--text-3)" }}
          >
            Signature
          </label>
          <select
            id="convo-signature-select"
            value={
              compose.selectedSigId === null
                ? ""
                : compose.selectedSigId === "none"
                  ? "none"
                  : String(compose.selectedSigId)
            }
            onChange={(e) => {
              const v = e.target.value;
              if (v === "none") compose.setSelectedSigId("none");
              else compose.setSelectedSigId(Number(v));
            }}
            style={{
              flex: 1,
              minWidth: 200,
              padding: "5px 8px",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--bg)",
              color: "var(--text)",
              fontSize: 12,
            }}
            aria-label="Email signature"
          >
            {compose.selectedSigId === null ? (
              <option value="" disabled>
                Loading…
              </option>
            ) : null}
            {compose.signatures.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.isDefault ? " (default)" : ""}
              </option>
            ))}
            <option value="none">None</option>
          </select>
        </div>
      ) : null}

      <textarea
        className={`${styles.cvCompArea} ${isNote ? styles.cvCompAreaNote : ""}`}
        value={compose.body}
        onChange={(e) => {
          compose.setBody(e.target.value);
          if (e.target.value.length > 0) compose.setExpanded(true);
        }}
        onFocus={() => compose.setExpanded(true)}
        placeholder={isNote ? "Mention a teammate with @ — not visible to the customer" : "Write your reply…"}
        rows={isNote ? 3 : 7}
        aria-label={isNote ? "Internal note" : "Reply"}
      />

      {showSigPreview && sigPreviewHtml ? (
        <div
          style={{
            marginTop: 6,
            paddingTop: 6,
            borderTop: "1px dashed var(--border)",
            fontSize: 12,
            color: "var(--text-3)",
          }}
        >
          <span style={{ display: "block", marginBottom: 4 }}>—</span>
          <div
            style={{ fontSize: 12.5, lineHeight: 1.45, color: "var(--text-2)" }}
            dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(sigPreviewHtml) }}
          />
        </div>
      ) : null}

      {hasFiles ? (
        <div className={styles.cvCompFiles}>
          {compose.attachments.map((f, idx) => (
            <span
              key={`${f.name}-${idx}`}
              className={styles.cvCompChipSm}
              title={`${f.name} · ${formatComposerFileSize(f.size)}`}
            >
              <span aria-hidden>📎</span>
              <span className={styles.cvCompChipName}>{f.name}</span>
              <span className={styles.cvCompChipSize}>{formatComposerFileSize(f.size)}</span>
              <button
                type="button"
                className={styles.cvCompChipRemove}
                onClick={() => compose.removeAttachment(idx)}
                aria-label={`Remove ${f.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {compose.attachmentsError ? (
        <div style={{ color: "var(--inbox-sla-late)", fontSize: 11.5, marginTop: 4 }}>
          {compose.attachmentsError}
        </div>
      ) : null}

      {automations && automations.suggestions.length > 0 ? (
        <div className={styles.cvCompAi}>
          <span className={styles.cvCompAiLbl}>✨ Suggested actions</span>
          {automations.suggestions.map((s) => {
            const label = describeSuggestion(s.ruleAction, s.proposedAction);
            return (
              <button
                key={s.id}
                type="button"
                className={styles.cvCompAiChip}
                title={`${s.ruleName}${s.confidence != null ? ` · confidence ${Math.round(s.confidence * 100)}%` : ""}`}
                onClick={async () => {
                  const r = await automations.acceptSuggestion(s.id);
                  if (r.ok) await onAutomationActed?.();
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className={styles.cvCompFoot}>
        <div className={styles.cvCompTools}>
          {allowAttachments ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files) compose.addAttachments(e.target.files);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              />
              <button
                type="button"
                className={styles.cvCompTool}
                title="Attach files"
                aria-label="Attach files"
                onClick={() => fileInputRef.current?.click()}
              >
                📎
              </button>
            </>
          ) : null}
        </div>
        <div className={styles.cvCompActions}>
          <button
            type="button"
            className={styles.cvCompPrimary}
            disabled={sendDisabled}
            onClick={onSend}
          >
            {isNote
              ? "Post note"
              : hasFiles
                ? `Send reply (${compose.attachments.length})`
                : "Send reply"}
          </button>
        </div>
      </div>
      </>
      )}
    </div>
  );
}

function AiSuggestPanel({
  suggestions,
  threadId,
  onAction,
  onClose,
}: {
  suggestions: UseAiSuggestions | null;
  threadId: string;
  onAction?: (s: { label: string; kind: AiSuggestionKind }) => void;
  onClose: () => void;
}) {
  const loading = suggestions?.loading ?? false;
  const error = suggestions?.error ?? null;
  const items = suggestions?.suggestions ?? [];
  const sourceTag =
    suggestions?.source === "fallback"
      ? "Showing fallback suggestions — model unavailable."
      : suggestions?.source === "model"
        ? "AI-generated · review before acting."
        : "";

  return (
    <div
      style={{
        marginTop: 8,
        padding: 14,
        background: "var(--panel-2)",
        border: "1px solid var(--border)",
        borderRadius: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
          ✨ Suggested follow-ups
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => void suggestions?.refresh(threadId)}
          disabled={loading}
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "4px 9px",
            fontSize: 11.5,
            color: "var(--text-2)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "4px 9px",
            fontSize: 11.5,
            color: "var(--text-2)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Close
        </button>
      </div>

      {loading && items.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--text-3)", padding: "10px 0" }}>
          Thinking…
        </div>
      ) : null}

      {error ? (
        <div style={{ fontSize: 12, color: "var(--inbox-sla-late, #B32317)", padding: "8px 0" }}>
          {error}
        </div>
      ) : null}

      {!loading && items.length === 0 && !error ? (
        <div style={{ fontSize: 12, color: "var(--text-3)", padding: "8px 0" }}>
          No suggestions available for this thread.
        </div>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {items.map((s, i) => (
          <button
            key={`${s.kind}-${i}`}
            type="button"
            onClick={() => onAction?.({ label: s.label, kind: s.kind })}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              background:
                "linear-gradient(180deg, rgba(122, 90, 224, 0.04), rgba(0, 152, 208, 0.04))",
              border: "1px solid var(--border)",
              borderRadius: 999,
              fontSize: 12,
              color: "var(--text-2)",
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
            title={`${suggestionKindLabel(s.kind)} action`}
          >
            <span aria-hidden style={{ color: suggestionKindColor(s.kind) }}>
              {suggestionKindGlyph(s.kind)}
            </span>
            {s.label}
          </button>
        ))}
      </div>

      {sourceTag ? (
        <div style={{ marginTop: 10, fontSize: 10.5, color: "var(--text-4)" }}>{sourceTag}</div>
      ) : null}
    </div>
  );
}

function suggestionKindLabel(k: AiSuggestionKind): string {
  return k === "task"
    ? "Create task"
    : k === "work_order"
      ? "Open work order"
      : k === "sms"
        ? "Send SMS"
        : k === "checklist"
          ? "Insert checklist"
          : "Info";
}

function suggestionKindGlyph(k: AiSuggestionKind): string {
  return k === "task"
    ? "✓"
    : k === "work_order"
      ? "🔧"
      : k === "sms"
        ? "💬"
        : k === "checklist"
          ? "☑"
          : "ℹ";
}

function suggestionKindColor(k: AiSuggestionKind): string {
  return k === "task"
    ? "#1F8A5B"
    : k === "work_order"
      ? "#B45309"
      : k === "sms"
        ? "#0098D0"
        : k === "checklist"
          ? "var(--accent)"
          : "var(--text-3)";
}

function formatComposerFileSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function describeSuggestion(
  action: string,
  proposed: { [key: string]: unknown } | null
): string {
  const p = proposed || {};
  switch (action) {
    case "assign":
      return `Assign to ${String(p.assignee_username || "—")}`;
    case "set_status":
      return `Set status to ${String(p.status || "—")}`;
    case "set_priority":
      return `Set priority to ${String(p.priority || "—")}`;
    case "close":
      return "Close conversation";
    case "star":
      return "Star conversation";
    case "escalate": {
      const who = String(p.assignee_username || "—");
      const pri = p.priority ? ` at ${p.priority}` : "";
      return `Escalate to ${who}${pri}`;
    }
    case "create_task":
      return "Create a task";
    case "create_work_order":
      return "Create a work order";
    case "apply_label":
      return `Apply tag ${String(p.label || "—")}`;
    default:
      return action;
  }
}
