"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../../forms.module.css";
import { apiUrl } from "../../../../../lib/api";
import { useAuth } from "../../../../../context/AuthContext";

type Version = {
  id: number;
  form_id: number;
  version_number: number;
  change_summary: string | null;
  published_at: string | null;
  created_at: string;
  created_by: number | null;
  created_by_name: string | null;
};

export default function VersionHistoryPanel({
  formId,
  currentVersion,
  onClose,
  onRestored,
}: {
  formId: number;
  currentVersion: number;
  onClose: () => void;
  onRestored: () => void;
}) {
  const { authHeaders, token } = useAuth();
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(apiUrl(`/forms/${formId}/versions`), {
        headers: { ...authHeaders() }, cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Load failed.");
      setVersions(body.versions || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load versions.");
    } finally {
      setLoading(false);
    }
  }, [formId, authHeaders, token]);

  useEffect(() => { load(); }, [load]);

  const restore = async (versionId: number, number: number) => {
    if (!confirm(`Restore v${number}? This creates a new version matching v${number}.`)) return;
    setBusy(versionId);
    try {
      const res = await fetch(apiUrl(`/forms/${formId}/versions/restore/${versionId}`), {
        method: "POST",
        headers: { ...authHeaders() },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Restore failed.");
      }
      onRestored();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Restore failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className={styles.slideoutBackdrop} onClick={onClose} />
      <aside className={styles.slideout}>
        <div className={styles.slideoutHeader}>
          <h2>Version History</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        <div className={styles.slideoutBody}>
          {err ? <div className={styles.errorBanner}>{err}</div> : null}
          {loading ? (
            <div className={styles.loading}>Loading…</div>
          ) : versions.length === 0 ? (
            <div className={styles.emptyState} style={{ padding: "1.5rem" }}>
              <h3>No versions yet</h3>
              <p>A version is recorded each time you publish.</p>
            </div>
          ) : (
            versions.map((v) => {
              const isCurrent = v.version_number === currentVersion;
              return (
                <div key={v.id} className={`${styles.versionItem} ${isCurrent ? styles.versionCurrent : ""}`}>
                  <div className={styles.versionNum}>
                    v{v.version_number}{isCurrent ? " · Current" : ""}
                  </div>
                  <p className={styles.versionSummary}>{v.change_summary || "—"}</p>
                  <div className={styles.versionMeta}>
                    {v.published_at ? `Published ${new Date(v.published_at).toLocaleString()}` : ""}
                    {v.created_by_name ? ` • by ${v.created_by_name}` : ""}
                  </div>
                  {!isCurrent ? (
                    <div className={styles.versionActions}>
                      <button
                        type="button"
                        className={styles.smallBtn}
                        onClick={() => restore(v.id, v.version_number)}
                        disabled={busy === v.id}
                      >
                        {busy === v.id ? "Restoring…" : "Restore"}
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
}
