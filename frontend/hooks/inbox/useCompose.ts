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
  /** Resets compose state when this changes. */
  ticketId: number | null;
  /** When the open ticket is read-only, the hook clamps mode to `"note"`. */
  readOnly: boolean;
};

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

  sending: boolean;
  send: () => Promise<ApiResult<void>>;
  reset: () => void;
};

export default function useCompose({ ticketId, readOnly }: UseComposeOptions): UseCompose {
  const { authHeaders } = useAuth();

  const [body, setBody] = useState("");
  const [mode, setModeRaw] = useState<ComposeMode>("reply");
  const [expanded, setExpanded] = useState(false);
  const [sending, setSending] = useState(false);

  const [signatures, setSignatures] = useState<EmailSignatureRow[]>([]);
  const [signaturesLoading, setSignaturesLoading] = useState(true);
  const [signaturesError, setSignaturesError] = useState<string | null>(null);
  const [selectedSigId, setSelectedSigId] = useState<SignatureSelection>(null);

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
  }, []);

  // Reset transient compose state when the active ticket changes.
  useEffect(() => {
    setBody("");
    setExpanded(false);
  }, [ticketId]);

  // Pick a default signature whenever the active ticket or the loaded signature list changes.
  useEffect(() => {
    if (!signatures.length) {
      setSelectedSigId("none");
      return;
    }
    const def = signatures.find((s) => s.isDefault);
    setSelectedSigId(def?.id ?? signatures[0].id);
  }, [ticketId, signatures]);

  // Read-only mailboxes can only post internal notes.
  useEffect(() => {
    if (readOnly) setModeRaw("note");
  }, [readOnly, ticketId]);

  const setMode = useCallback(
    (m: ComposeMode) => {
      if (readOnly && m === "reply") return;
      setModeRaw(m);
      setExpanded(false);
    },
    [readOnly]
  );

  const send = useCallback(async (): Promise<ApiResult<void>> => {
    if (ticketId == null) return { ok: false, error: "No ticket selected." };
    const trimmed = body.trim();
    if (!trimmed) return { ok: false, error: "Message is empty." };
    setSending(true);
    try {
      const path = mode === "reply" ? "reply" : "note";
      let replySigHtml: string | null = null;
      if (mode === "reply" && selectedSigId !== "none" && selectedSigId !== null) {
        const row = signatures.find((s) => s.id === selectedSigId);
        const raw = row?.signatureHtml?.trim();
        replySigHtml = raw ? raw : null;
      }
      const payload =
        mode === "reply"
          ? { body: buildReplyEmailHtml(body, replySigHtml) }
          : { body: trimmed };
      const res = await fetch(apiUrl(`/inbox/tickets/${ticketId}/${path}`), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        return { ok: false, error: parseApiError(j, res.status) };
      }
      setBody("");
      setExpanded(false);
      return { ok: true, data: undefined };
    } catch (e) {
      return { ok: false, error: networkErrorMessage(e) };
    } finally {
      setSending(false);
    }
  }, [authHeaders, body, mode, selectedSigId, signatures, ticketId]);

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
    sending,
    send,
    reset,
  };
}
