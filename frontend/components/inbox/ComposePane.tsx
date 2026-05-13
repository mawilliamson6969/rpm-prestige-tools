"use client";

import { useRef } from "react";
import styles from "../../app/(protected)/inbox/inbox.module.css";
import { sanitizeEmailHtml } from "../../lib/sanitizeEmailHtml";
import type { ThreadRow } from "../../hooks/inbox/types";
import type { UseAIDraft } from "../../hooks/inbox/useAIDraft";
import type { UseCompose } from "../../hooks/inbox/useCompose";
import { hasNoAiContext } from "./inboxConstants";

type Props = {
  thread: ThreadRow;
  compose: UseCompose;
  aiDraft: UseAIDraft;
  /** Mailbox permission allows replying. */
  canReply: boolean;
  /** Triggered when the AI Draft button is clicked. Orchestrator wires this to seed compose. */
  onRunAiDraft: () => void;
  /** Triggered when the user clicks Dismiss on the AI banner. */
  onDismissAiDraft: () => void;
  /** Triggered after a successful send (orchestrator refetches detail/list). */
  onSend: () => void;
};

export default function ComposePane({
  thread,
  compose,
  aiDraft,
  canReply,
  onRunAiDraft,
  onDismissAiDraft,
  onSend,
}: Props) {
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
    <div className={styles.composeDock}>
      <div className={`${styles.compose} ${aiDraft.loading ? styles.composeBusy : ""}`}>
        {aiDraft.loading ? (
          <div className={styles.aiDraftOverlay}>
            <span className={styles.spinner} aria-hidden />
            <span>{aiDraft.loadingMessage || "Drafting…"}</span>
          </div>
        ) : null}

        {!canReply ? (
          <p className={styles.readOnlyReplyNote}>
            You have read-only access to this mailbox. You can add internal notes below; replies are
            disabled.
          </p>
        ) : null}

        <div className={styles.tabs}>
          {canReply ? (
            <button
              type="button"
              className={`${styles.tabBtn} ${compose.mode === "reply" ? styles.active : ""}`}
              onClick={() => compose.setMode("reply")}
            >
              Reply
            </button>
          ) : null}
          <button
            type="button"
            className={`${styles.tabBtn} ${compose.mode === "note" ? styles.active : ""}`}
            onClick={() => compose.setMode("note")}
          >
            Internal note
          </button>
          {canReply ? (
            <button
              type="button"
              className={styles.aiDraftTabBtn}
              onClick={onRunAiDraft}
              disabled={aiDraft.loading}
            >
              ✨ AI Draft Reply
            </button>
          ) : null}
        </div>

        {aiDraft.bannerVisible && compose.mode === "reply" ? (
          <div className={styles.aiDraftBanner}>
            <span>AI-drafted response — review and edit before sending</span>
            <button type="button" className={styles.aiDraftDismiss} onClick={onDismissAiDraft}>
              Dismiss
            </button>
          </div>
        ) : null}

        {aiDraft.bannerVisible && compose.mode === "reply" && aiDraft.contextUsed ? (
          <details className={styles.contextUsed}>
            <summary>Context used</summary>
            {hasNoAiContext(aiDraft.contextUsed) ? (
              <p className={styles.contextUsedBody}>No matching context found</p>
            ) : (
              <ul className={styles.contextUsedList}>
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
                  LeadSimple: {aiDraft.contextUsed.leadsimple ? "✓ open deals/tasks matched" : "—"}
                </li>
              </ul>
            )}
          </details>
        ) : null}

        {compose.mode === "reply" && canReply && thread.mailbox_email ? (
          <p className={styles.replyFromLine}>
            Replying from: {(thread.mailbox_email || "").trim()}
          </p>
        ) : null}

        {compose.mode === "reply" && canReply ? (
          <div className={styles.sigSelectRow}>
            <label className={styles.sigSelectLabel} htmlFor="inbox-signature-select">
              Signature:
            </label>
            <select
              id="inbox-signature-select"
              className={styles.sigSelect}
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
          className={!compose.expanded ? styles.composeCollapsed : undefined}
          value={compose.body}
          onChange={(e) => {
            compose.setBody(e.target.value);
            if (e.target.value.length > 0) compose.setExpanded(true);
          }}
          onFocus={() => compose.setExpanded(true)}
          placeholder={compose.mode === "reply" ? "Reply…" : "Internal note (not emailed)…"}
          rows={compose.expanded ? 6 : 1}
          aria-label={compose.mode === "reply" ? "Reply" : "Internal note"}
        />

        {showSigPreview && sigPreviewHtml ? (
          <div className={styles.replySignaturePreview}>
            <div className={styles.replySigDivider} aria-hidden />
            <p className={styles.replySigDash}>--</p>
            <div
              className={styles.replySigRendered}
              dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(sigPreviewHtml) }}
            />
          </div>
        ) : null}

        {compose.expanded ? (
          <ComposeFooter compose={compose} canReply={canReply} onSend={onSend} />
        ) : null}
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const FILE_CHIP: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.4rem",
  border: "1px solid #cfd4dc",
  borderRadius: 999,
  padding: "0.2rem 0.55rem",
  background: "#f9fafc",
  fontSize: "0.78rem",
  color: "#1b2856",
  marginRight: "0.35rem",
  marginTop: "0.3rem",
};

function ComposeFooter({
  compose,
  canReply,
  onSend,
}: {
  compose: Props["compose"];
  canReply: boolean;
  onSend: Props["onSend"];
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const allowAttachments = compose.mode === "reply" && canReply;
  const hasFiles = compose.attachments.length > 0;
  const sendDisabled = compose.sending || (!compose.body.trim() && !hasFiles);
  return (
    <div style={{ marginTop: "0.5rem" }}>
      {hasFiles ? (
        <div style={{ display: "flex", flexWrap: "wrap", marginBottom: "0.35rem" }}>
          {compose.attachments.map((f, idx) => (
            <span key={`${f.name}-${idx}`} style={FILE_CHIP} title={`${f.name} · ${formatBytes(f.size)}`}>
              <span aria-hidden>📎</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "180px" }}>
                {f.name}
              </span>
              <span style={{ color: "#6a737b" }}>{formatBytes(f.size)}</span>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => compose.removeAttachment(idx)}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "#6a737b",
                  fontSize: "0.95rem",
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
        <div style={{ color: "#b32317", fontSize: "0.78rem", marginBottom: "0.35rem" }}>
          {compose.attachmentsError}
        </div>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
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
              onClick={() => fileInputRef.current?.click()}
              title="Attach files"
              aria-label="Attach files"
              style={{
                background: "transparent",
                border: "1px solid #cfd4dc",
                borderRadius: 6,
                padding: "0.35rem 0.6rem",
                cursor: "pointer",
                fontSize: "0.95rem",
              }}
            >
              📎
            </button>
          </>
        ) : null}
        <button
          type="button"
          className={styles.sendBtn}
          disabled={sendDisabled}
          onClick={onSend}
          style={{ marginLeft: "auto" }}
        >
          {compose.mode === "reply"
            ? hasFiles
              ? `Send reply (${compose.attachments.length})`
              : "Send reply"
            : "Add note"}
        </button>
      </div>
    </div>
  );
}
