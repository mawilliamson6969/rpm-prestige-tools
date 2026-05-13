"use client";

// Conversation composer — D0-aligned design.
// Wraps the existing useCompose / useAIDraft state in the new tabbed
// (Reply / Internal note / Forward) layout from the design. Forward is
// shown but disabled — no forward path exists yet.

import { useRef } from "react";
import styles from "./conversation.module.css";
import { sanitizeEmailHtml } from "../../../lib/sanitizeEmailHtml";
import type { ThreadRow } from "../../../hooks/inbox/types";
import type { UseAIDraft } from "../../../hooks/inbox/useAIDraft";
import type { UseCompose } from "../../../hooks/inbox/useCompose";
import { hasNoAiContext } from "../inboxConstants";

type Props = {
  thread: ThreadRow;
  compose: UseCompose;
  aiDraft: UseAIDraft;
  canReply: boolean;
  onRunAiDraft: () => void;
  onDismissAiDraft: () => void;
  onSend: () => void;
};

export default function ConvoComposer({
  thread,
  compose,
  aiDraft,
  canReply,
  onRunAiDraft,
  onDismissAiDraft,
  onSend,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isNote = compose.mode === "note";
  const allowAttachments = compose.mode === "reply" && canReply;
  const hasFiles = compose.attachments.length > 0;
  const sendDisabled = compose.sending || (!compose.body.trim() && !hasFiles);

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

  return (
    <div className={styles.cvComposer}>
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
            className={styles.cvCompSuggest}
            onClick={onRunAiDraft}
            disabled={aiDraft.loading}
          >
            ✨ {aiDraft.loading ? "Drafting…" : "AI suggest"}
          </button>
        ) : null}
      </div>

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
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {compose.attachments.map((f, idx) => (
            <span
              key={`${f.name}-${idx}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 8px",
                background: "var(--panel-2)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                fontSize: 11.5,
                color: "var(--text-2)",
                fontWeight: 500,
              }}
            >
              📎 {f.name}
              <button
                type="button"
                onClick={() => compose.removeAttachment(idx)}
                aria-label={`Remove ${f.name}`}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-3)",
                  fontSize: 14,
                  lineHeight: 1,
                  padding: 0,
                }}
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
    </div>
  );
}
