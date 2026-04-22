"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "../forms.module.css";
import { apiUrl } from "../../../../lib/api";
import { useAuth } from "../../../../context/AuthContext";

type PendingApproval = {
  id: number;
  submission_id: number;
  form_id: number;
  form_name: string;
  form_slug: string;
  contact_name: string | null;
  contact_email: string | null;
  submitted_at: string;
  status: string;
  step_order: number;
};

export default function ApprovalsClient() {
  const { authHeaders, token } = useAuth();
  const [rows, setRows] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/forms/approvals/my"), {
        headers: { ...authHeaders() }, cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Load failed.");
      setRows(body.approvals || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load approvals.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <div className={styles.titleBlock}>
          <h1>My Approvals</h1>
          <p>{rows.length} awaiting your decision</p>
        </div>
        <Link href="/forms" className={`${styles.btn} ${styles.btnGhost}`}>← Back to Forms</Link>
      </div>
      <div className={styles.main}>
        {err ? <div className={styles.errorBanner}>{err}</div> : null}
        {loading ? (
          <div className={styles.loading}>Loading…</div>
        ) : rows.length === 0 ? (
          <div className={styles.emptyState}>
            <h3>No pending approvals</h3>
            <p>You're all caught up.</p>
          </div>
        ) : (
          <table className={styles.subTable}>
            <thead>
              <tr>
                <th>Form</th>
                <th>Submitter</th>
                <th>Email</th>
                <th>Submitted</th>
                <th>Step</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.form_name}</td>
                  <td>{r.contact_name || "—"}</td>
                  <td>{r.contact_email || "—"}</td>
                  <td>{new Date(r.submitted_at).toLocaleString()}</td>
                  <td>#{r.step_order + 1}</td>
                  <td>
                    <Link
                      href={`/forms/${r.form_id}/submissions?open=${r.submission_id}`}
                      className={styles.smallBtn}
                    >
                      Review
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
