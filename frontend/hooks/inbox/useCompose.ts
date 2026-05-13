"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { apiUrl } from "../../lib/api";
import { networkErrorMessage, parseApiError, type ApiResult } from "../../lib/apiResult";
import type { ComposeMode, EmailSignatureRow } from "./types";

function escapeHtmlText(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Builds HTML for Graph API reply: message + optional `--` + signature HTML. */
export function buildReplyEmailHtml(message: string, signatureHtml: string | null) {
  const t = message.trim();
  const main = escapeHtmlText(t).replace(/\r\n/g, "\n").split("\n").join("<br/>");
  const body = `<div style="font-family:Segoe UI,system-ui,sans-serif;font-size:11pt">${main}</div>`;
  const sig = signatureHtml?.trim();
  if (!sig) return body;
  return `${body}<p style="font-family:Segoe UI,system-ui,sans-serif;font-size:11pt">-- </p><div style="font-family:Segoe UI,system-ui,sans-serif;font-size:11pt">${sig}</div>`;
}

export type SignatureSelection = number | "none" | null;

export type UseComposeOptions = {
  /** Phase 1: thread is the canonical entity. Reset compose state when this changes. */
  threadId: string | null;
  /** Seed ticket id used by the legacy ticket-scoped note endpoint. */
  seedTicketId: number | null;
  /** When the active mailbox is read-only, the hook clamps mode to `"note"`. */
  readOnly: boolean;
};

/** 25 MB total cap, mirroring backend MAX_TOTAL_BYTES. */
export const MAX_ATTACHMENTS_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENT_INLINE_BYTES = 3 * 1024 * 1024;

export type UseCompose = {
  body: string;
  setBody: (s: string) => void;
  mode: ComposeMode;
  setMode: (m: ComposeMode) => void;
  expanded: boolean;
  setExpanded: (v: boolean) => void;

  signatures: EmailSignatureRow[];
  signaturesLoading: boolean;
  signaturesError: string | null;
  selectedSigId: SignatureSelection;
  setSelectedSigId: (id: SignatureSelection) => void;

  /** Files staged on the reply. Empty array means JSON send path. */
  attachments: File[];
  /** Pre-flight error (e.g. exceeded total cap or per-file inline cap). */
  attachmentsError: string | null;
  addAttachments: (files: FileList | File[]) => void;
  removeAttachment: (idx: number) => void;
  clearAttachments: () => void;

  sending: boolean;
  send: () => Promise<ApiResult<void>>;
  reset: () => void;
};

export default function useCompose({
  threadId,
  seedTicketId,
  readOnly,
}: UseComposeOptions): UseCompose {
  const { authHeaders } = useAuth();

  const [body, setBody] = useState("");
  const [mode, setModeRaw] = useState<ComposeMode>("reply");
  const [expanded, setExpanded] = useState(false);
  const [sending, setSending] = useState(false);

  const [signatures, setSignatures] = useState<EmailSignatureRow[]>([]);
  const [signaturesLoading, setSignaturesLoading] = useState(true);
  const [signaturesError, setSignaturesError] = useState<string | null>(null);
  const [selectedSigId, setSelectedSigId] = useState<SignatureSelection>(null);

  const [attachments, setAttachments] = useState<File[]>([]);
  const [attachmentsError, setAttachmentsError] = useState<string | null>(null);

  const validateAttachments = useCallback((files: File[]): string | null => {
    let total = 0;
    for (const f of files) {
      if (f.size > MAX_ATTACHMENT_INLINE_BYTES) {
        return `${f.name} is ${(f.size / 1024 / 1024).toFixed(1)} MB. Per-file cap is ${MAX_ATTACHMENT_INLINE_BYTES / 1024 / 1024} MB until upload-session protocol is wired.`;
      }
      total += f.size;
    }
    if (total > MAX_ATTACHMENTS_BYTES) {
      return `Total attachment size ${(total / 1024 / 1024).toFixed(1)} MB exceeds the ${MAX_ATTACHMENTS_BYTES / 1024 / 1024} MB cap.`;
    }
    return null;
  }, []);

  const addAttachments = useCallback(
    (files: FileList | File[]) => {
      setAttachmentsError(null);
      setAttachments((prev) => {
        const next = [...prev, ...Array.from(files)];
        const err = validateAttachments(next);
        if (err) {
          setAttachmentsError(err);
          return prev;
        }
        return next;
      });
    },
    [validateAttachments]
  );
  const removeAttachment = useCallback((idx: number) => {
    setAttachmentsError(null);
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }, []);
  const clearAttachments = useCallback(() => {
    setAttachments([]);
    setAttachmentsError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl("/inbox/signatures"), {
          cache: "no-store",
          headers: { ...authHeaders() },
        });
        const j = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setSignaturesError(parseApiError(j, res.status));
          return;
        }
        if (Array.isArray(j.signatures)) setSignatures(j.signatures as EmailSignatureRow[]);
        setSignaturesError(null);
      } catch (e) {
        if (!cancelled) setSignaturesError(networkErrorMessage(e));
      } finally {
        if (!cancelled) setSignaturesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authHeaders]);

  const reset = useCallback(() => {
    setBody("");
    setExpanded(false);
    setAttachments([]);
    setAttachmentsError(null);
  }, []);

  // Reset transient compose state when the active ticket changes.
  useEffect(() => {
    setBody("");
    setExpanded(false);
    setAttachments([]);
    setAttachmentsError(null);
  }, [threadId]);

  // Pick a default signature whenever the active ticket or the loaded signature list changes.
  useEffect(() => {
    if (!signatures.length) {
      setSelectedSigId("none");
      return;
    }
    const def = signatures.find((s) => s.isDefault);
    setSelectedSigId(def?.id ?? signatures[0].id);
  }, [threadId, signatures]);

  // Read-only mailboxes can only post internal notes.
  useEffect(() => {
    if (readOnly) setModeRaw("note");
  }, [readOnly, threadId]);

  const setMode = useCallback(
    (m: ComposeMode) => {
      if (readOnly && m === "reply") return;
      setModeRaw(m);
      setExpanded(false);
    },
    [readOnly]
  );

  const send = useCallback(async (): Promise<ApiResult<void>> => {
    const trimmed = body.trim();
    const hasFiles = attachments.length > 0;
    if (!trimmed && !(mode === "reply" && hasFiles)) {
      return { ok: false, error: "Message is empty." };
    }
    if (mode === "reply" && !threadId) return { ok: false, error: "No thread selected." };
    if (mode === "note" && seedTicketId == null) {
      return { ok: false, error: "No message to attach a note to." };
    }
    if (mode === "note" && hasFiles) {
      return { ok: false, error: "Notes don't support attachments — switch to Reply." };
    }
    if (hasFiles) {
      const err = validateAttachments(attachments);
      if (err) return { ok: false, error: err };
    }
    setSending(true);
    try {
      let replySigHtml: string | null = null;
      if (mode === "reply" && selectedSigId !== "none" && selectedSigId !== null) {
        const row = signatures.find((s) => s.id === selectedSigId);
        const raw = row?.signatureHtml?.trim();
        replySigHtml = raw ? raw : null;
      }

      let res: Response;
      if (mode === "reply" && hasFiles) {
        const fd = new FormData();
        fd.set("body", buildReplyEmailHtml(body, replySigHtml));
        for (const f of attachments) fd.append("attachments", f, f.name);
        res = await fetch(
          apiUrl(`/inbox/threads/${encodeURIComponent(threadId as string)}/messages-with-attachments`),
          {
            method: "POST",
            headers: { ...authHeaders() }, // don't set Content-Type — let the browser set the boundary
            body: fd,
          }
        );
      } else {
        const url =
          mode === "reply"
            ? apiUrl(`/inbox/threads/${encodeURIComponent(threadId as string)}/messages`)
            : apiUrl(`/inbox/tickets/${seedTicketId}/note`);
        const payload =
          mode === "reply"
            ? { body: buildReplyEmailHtml(body, replySigHtml) }
            : { body: trimmed };
        res = await fetch(url, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        return { ok: false, error: parseApiError(j, res.status) };
      }
      setBody("");
      setExpanded(false);
      setAttachments([]);
      setAttachmentsError(null);
      return { ok: true, data: undefined };
    } catch (e) {
      return { ok: false, error: networkErrorMessage(e) };
    } finally {
      setSending(false);
    }
  }, [
    authHeaders,
    body,
    mode,
    selectedSigId,
    signatures,
    threadId,
    seedTicketId,
    attachments,
    validateAttachments,
  ]);

  return {
    body,
    setBody,
    mode,
    setMode,
    expanded,
    setExpanded,
    signatures,
    signaturesLoading,
    signaturesError,
    selectedSigId,
    setSelectedSigId,
    attachments,
    attachmentsError,
    addAttachments,
    removeAttachment,
    clearAttachments,
    sending,
    send,
    reset,
  };
}
