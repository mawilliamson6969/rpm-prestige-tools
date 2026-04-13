"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { apiUrl } from "../../lib/api";
import MarkdownBody from "./MarkdownBody";
import styles from "./wiki-version-panel.module.css";

type VersionRow = {
  id: number;
  version_number: number;
  title: string | null;
  change_summary: string | null;
  created_at: string;
  edited_by_name: string | null;
  charsAdded: number;
  charsRemoved: number;
  isCurrent: boolean;
};

export default function WikiVersionPanel({
  open,
  pageId,
  onClose,
  onRestored,
}: {
  open: boolean;
  pageId: number;
  onClose: () => void;
  onRestored: () => void;
}) {
  const { authHeaders } = useAuth();
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [previewMd, setPreviewMd] = useState("");
  const [previewTitle, setPreviewTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl(`/wiki/pages/${pageId}/versions`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Load failed.");
      setVersions(Array.isArray(body.versions) ? body.versions : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, pageId]);

  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      setVersions([]);
      return;
    }
    loadList();
  }, [open, loadList]);

  useEffect(() => {
    if (!open || !versions.length) return;
    setSelectedId((prev) => {
      if (prev) return prev;
      const def = versions.find((v) => v.isCurrent) ?? versions[versions.length - 1];
      return def?.id ?? null;
    });
  }, [open, versions]);

  const loadVersion = useCallback(
    async (versionRowId: number) => {
      setErr(null);
      try {
        const res = await fetch(apiUrl(`/wiki/pages/${pageId}/versions/${versionRowId}`), {
          headers: { ...authHeaders() },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Load failed.");
        const v = body.version;
        setPreviewTitle(typeof v?.title === "string" ? v.title : "");
        setPreviewMd(typeof v?.content_markdown === "string" ? v.content_markdown : "");
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Error");
      }
    },
    [authHeaders, pageId]
  );

  useEffect(() => {
    if (!open || !selectedId) return;
    loadVersion(selectedId);
  }, [open, selectedId, loadVersion]);

  const onPick = (v: VersionRow) => {
    setSelectedId(v.id);
  };

  const onRestore = async () => {
    if (!selectedId) return;
    setRestoreBusy(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl(`/wiki/pages/${pageId}/versions/${selectedId}/restore`), {
        method: "POST",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Restore failed.");
      await loadList();
      onRestored();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setRestoreBusy(false);
    }
  };

  const selectedRow = versions.find((x) => x.id === selectedId);

  if (!open) return null;

  return (
    <>
      <div className={styles.backdrop} role="presentation" onClick={onClose} />
      <aside className={styles.panel} aria-label="Version history">
        <div className={styles.panelHeader}>
          <h2>Version history</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {err ? (
          <p style={{ color: "#b32317", padding: "0 1rem" }}>{err}</p>
        ) : loading ? (
          <p style={{ padding: "0 1rem", color: "#6a737b" }}>Loading…</p>
        ) : (
          <div className={styles.list}>
            {[...versions].reverse().map((v) => (
              <button
                key={v.id}
                type="button"
                className={`${styles.versionRow} ${selectedId === v.id ? styles.versionRowActive : ""}`}
                onClick={() => onPick(v)}
              >
                <div className={styles.versionTop}>
                  <span className={styles.versionNum}>v{v.version_number}</span>
                  <span className={styles.versionDiff}>
                    +{v.charsAdded} / −{v.charsRemoved} chars
                  </span>
                </div>
                <div style={{ fontSize: "0.85rem", color: "#2c3338" }}>{v.change_summary || "—"}</div>
                <div style={{ fontSize: "0.78rem", color: "#6a737b", marginTop: "0.25rem" }}>
                  {v.edited_by_name ?? "—"} · {new Date(v.created_at).toLocaleString()}
                </div>
                {v.isCurrent ? (
                  <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#0098d0", marginTop: "0.35rem" }}>
                    Current
                  </div>
                ) : null}
              </button>
            ))}
          </div>
        )}
        <div className={styles.preview}>
          <strong style={{ color: "#1b2856" }}>{previewTitle}</strong>
          <div style={{ marginTop: "0.75rem", fontSize: "0.9rem" }}>
            <MarkdownBody markdown={previewMd || "_No content._"} />
          </div>
          {selectedId ? (
            <div style={{ marginTop: "1rem" }}>
              <button
                type="button"
                className={styles.versionRow}
                style={{
                  width: "100%",
                  cursor: restoreBusy || selectedRow?.isCurrent ? "default" : "pointer",
                  fontWeight: 700,
                }}
                onClick={() => {
                  if (!selectedRow?.isCurrent) onRestore();
                }}
                disabled={restoreBusy || !!selectedRow?.isCurrent}
              >
                {selectedRow?.isCurrent
                  ? "Already current version"
                  : restoreBusy
                    ? "Restoring…"
                    : "Restore this version"}
              </button>
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}
