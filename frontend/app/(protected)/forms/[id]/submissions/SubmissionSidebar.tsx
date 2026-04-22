"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../../forms.module.css";
import { apiUrl } from "../../../../../lib/api";
import { useAuth } from "../../../../../context/AuthContext";

type User = { id: number; displayName: string };

type Note = { id: number; user_id: number; note: string; created_at: string; user_name?: string };
type Approval = {
  id: number; approver_user_id: number; status: string; decision_notes: string | null;
  decided_at: string | null; step_order: number; approver_name?: string;
};
type GenDoc = { id: number; filename: string; template_name: string | null; generated_at: string };
type DocTemplate = { id: number; name: string };

export default function SubmissionSidebar({
  submissionId,
  initialStatus,
  onChanged,
}: {
  submissionId: number;
  initialStatus: string;
  onChanged: () => void;
}) {
  const { authHeaders, token, user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [decisionNotes, setDecisionNotes] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [detail, setDetail] = useState<{
    assigned_to: number | null; priority: string; is_starred: boolean; form_id: number;
  } | null>(null);
  const [docTemplates, setDocTemplates] = useState<DocTemplate[]>([]);
  const [genDocs, setGenDocs] = useState<GenDoc[]>([]);
  const [generating, setGenerating] = useState(false);

  const fetchSub = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl(`/forms/submissions/${submissionId}`), {
        headers: { ...authHeaders() }, cache: "no-store",
      });
      if (res.ok) {
        const b = await res.json();
        const s = b.submission;
        setDetail({
          assigned_to: s.assigned_to ?? null,
          priority: s.priority || "normal",
          is_starred: !!s.is_starred,
          form_id: s.formId,
        });
        // Load doc templates for this form
        const tr = await fetch(apiUrl(`/forms/${s.formId}/document-templates`), {
          headers: { ...authHeaders() }, cache: "no-store",
        });
        if (tr.ok) {
          const tb = await tr.json();
          setDocTemplates(tb.templates || []);
        }
      }
    } catch {/* ignore */}
  }, [submissionId, authHeaders, token]);

  const loadNotes = useCallback(async () => {
    if (!token) return;
    const res = await fetch(apiUrl(`/forms/submissions/${submissionId}/notes`), {
      headers: { ...authHeaders() }, cache: "no-store",
    });
    if (res.ok) setNotes((await res.json()).notes || []);
  }, [submissionId, authHeaders, token]);

  const loadTags = useCallback(async () => {
    if (!token) return;
    const res = await fetch(apiUrl(`/forms/submissions/${submissionId}/tags`), {
      headers: { ...authHeaders() }, cache: "no-store",
    });
    if (res.ok) setTags((await res.json()).tags || []);
  }, [submissionId, authHeaders, token]);

  const loadUsers = useCallback(async () => {
    if (!token) return;
    const res = await fetch(apiUrl("/users"), { headers: { ...authHeaders() }, cache: "no-store" });
    if (res.ok) setUsers((await res.json()).users || []);
  }, [authHeaders, token]);

  const loadApprovals = useCallback(async () => {
    if (!token) return;
    const res = await fetch(apiUrl(`/forms/submissions/${submissionId}/approvals`), {
      headers: { ...authHeaders() }, cache: "no-store",
    });
    if (res.ok) setApprovals((await res.json()).approvals || []);
  }, [submissionId, authHeaders, token]);

  const loadDocs = useCallback(async () => {
    if (!token) return;
    const res = await fetch(apiUrl(`/forms/submissions/${submissionId}/documents`), {
      headers: { ...authHeaders() }, cache: "no-store",
    });
    if (res.ok) setGenDocs((await res.json()).documents || []);
  }, [submissionId, authHeaders, token]);

  useEffect(() => { fetchSub(); loadNotes(); loadTags(); loadUsers(); loadApprovals(); loadDocs(); }, [fetchSub, loadNotes, loadTags, loadUsers, loadApprovals, loadDocs]);

  const addNote = async () => {
    const note = noteDraft.trim();
    if (!note) return;
    await fetch(apiUrl(`/forms/submissions/${submissionId}/notes`), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ note }),
    });
    setNoteDraft("");
    await loadNotes();
  };
  const deleteNote = async (id: number) => {
    await fetch(apiUrl(`/forms/submission-notes/${id}`), { method: "DELETE", headers: { ...authHeaders() } });
    await loadNotes();
  };

  const addTag = async () => {
    const tag = tagDraft.trim();
    if (!tag) return;
    await fetch(apiUrl(`/forms/submissions/${submissionId}/tags`), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ tag }),
    });
    setTagDraft("");
    await loadTags();
  };
  const removeTag = async (tag: string) => {
    await fetch(apiUrl(`/forms/submissions/${submissionId}/tags/${encodeURIComponent(tag)}`), {
      method: "DELETE", headers: { ...authHeaders() },
    });
    await loadTags();
  };

  const setAssigned = async (userId: number | null) => {
    await fetch(apiUrl(`/forms/submissions/${submissionId}/assign`), {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ userId }),
    });
    await fetchSub();
  };

  const setPriority = async (priority: string) => {
    await fetch(apiUrl(`/forms/submissions/${submissionId}/priority`), {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ priority }),
    });
    await fetchSub();
  };

  const toggleStar = async () => {
    await fetch(apiUrl(`/forms/submissions/${submissionId}/star`), {
      method: "PUT", headers: { ...authHeaders() },
    });
    await fetchSub();
  };

  const decide = async (decision: "approve" | "reject") => {
    setDeciding(true);
    try {
      await fetch(apiUrl(`/forms/submissions/${submissionId}/${decision}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ notes: decisionNotes }),
      });
      setDecisionNotes("");
      await loadApprovals();
      onChanged();
    } finally {
      setDeciding(false);
    }
  };

  const generateDoc = async (templateId: number) => {
    setGenerating(true);
    try {
      const res = await fetch(apiUrl(`/forms/submissions/${submissionId}/generate-document/${templateId}`), {
        method: "POST", headers: { ...authHeaders() },
      });
      if (res.ok) {
        const body = await res.json();
        const doc = body.document;
        const dl = await fetch(apiUrl(`/forms/documents/${doc.id}/download`), {
          headers: { ...authHeaders() },
        });
        if (dl.ok) {
          const blob = await dl.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = doc.filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        await loadDocs();
      }
    } finally {
      setGenerating(false);
    }
  };

  const downloadDoc = async (id: number, filename: string) => {
    const dl = await fetch(apiUrl(`/forms/documents/${id}/download`), {
      headers: { ...authHeaders() },
    });
    if (!dl.ok) return;
    const blob = await dl.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const myPendingApproval = approvals.find(
    (a) => a.approver_user_id === user?.id && a.status === "pending"
  );
  const canDecide = !!myPendingApproval;

  return (
    <aside className={styles.subSidebar}>
      {canDecide ? (
        <div className={styles.approveBox}>
          <strong style={{ color: "#92400e", fontSize: "0.9rem" }}>Approval required</strong>
          <p style={{ margin: "0.3rem 0", fontSize: "0.82rem", color: "#7c2d12" }}>
            Step {myPendingApproval!.step_order + 1} — your decision.
          </p>
          <textarea
            placeholder="Optional notes…"
            value={decisionNotes}
            onChange={(e) => setDecisionNotes(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", padding: "0.4rem", border: "1px solid rgba(27,40,86,0.15)", borderRadius: 6, fontFamily: "inherit", fontSize: "0.85rem", minHeight: 50 }}
          />
          <div className={styles.approveActions}>
            <button
              type="button"
              className={styles.btnApprove}
              disabled={deciding}
              onClick={() => decide("approve")}
            >✓ Approve</button>
            <button
              type="button"
              className={styles.btnReject}
              disabled={deciding}
              onClick={() => decide("reject")}
            >✕ Reject</button>
          </div>
        </div>
      ) : null}

      {approvals.length ? (
        <div className={styles.subSidebarBlock}>
          <div className={styles.subSidebarLabel}>Approval history</div>
          {approvals.map((a) => (
            <div key={a.id} className={styles.approveRow}>
              <span className={`${styles.approveStatus} ${a.status === "approved" ? styles.approveStatusApproved : a.status === "rejected" ? styles.approveStatusRejected : styles.approveStatusPending}`}>
                {a.status}
              </span>
              <div style={{ flex: 1, fontSize: "0.82rem", color: "#1b2856" }}>
                Step {a.step_order + 1} — {a.approver_name || `User ${a.approver_user_id}`}
                {a.decision_notes ? <div style={{ color: "#6a737b", marginTop: "0.15rem" }}>{a.decision_notes}</div> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.subSidebarBlock}>
        <div className={styles.subSidebarLabel}>Priority &amp; Star</div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <select
            className={styles.select}
            value={detail?.priority || "normal"}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
          <button
            type="button"
            className={`${styles.starBtn} ${detail?.is_starred ? styles.starBtnActive : ""}`}
            onClick={toggleStar}
            title="Star"
          >{detail?.is_starred ? "★" : "☆"}</button>
        </div>
      </div>

      <div className={styles.subSidebarBlock}>
        <div className={styles.subSidebarLabel}>Assigned to</div>
        <select
          className={styles.select}
          value={detail?.assigned_to ?? ""}
          onChange={(e) => setAssigned(e.target.value ? Number(e.target.value) : null)}
          style={{ width: "100%" }}
        >
          <option value="">Unassigned</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.displayName}</option>
          ))}
        </select>
      </div>

      <div className={styles.subSidebarBlock}>
        <div className={styles.subSidebarLabel}>Tags</div>
        <div className={styles.tagChipInput}>
          {tags.map((t) => (
            <span key={t} className={styles.tagChip}>
              {t}
              <button type="button" className={styles.tagChipRemove} onClick={() => removeTag(t)}>×</button>
            </span>
          ))}
          <input
            type="text"
            placeholder="Add tag…"
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); }
            }}
          />
        </div>
      </div>

      {docTemplates.length ? (
        <div className={styles.subSidebarBlock}>
          <div className={styles.subSidebarLabel}>Generate Document</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            {docTemplates.map((t) => (
              <button
                key={t.id}
                type="button"
                className={styles.smallBtn}
                onClick={() => generateDoc(t.id)}
                disabled={generating}
                style={{ textAlign: "left" }}
              >
                {generating ? "Generating…" : `📄 ${t.name}`}
              </button>
            ))}
          </div>
          {genDocs.length ? (
            <div style={{ marginTop: "0.5rem" }}>
              <div className={styles.subSidebarLabel} style={{ fontSize: "0.68rem" }}>Generated</div>
              {genDocs.map((d) => (
                <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.82rem", padding: "0.2rem 0" }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, marginRight: "0.35rem" }}>{d.filename}</span>
                  <button type="button" className={styles.smallBtn} onClick={() => downloadDoc(d.id, d.filename)}>↓</button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={styles.subSidebarBlock}>
        <div className={styles.subSidebarLabel}>Notes</div>
        <div className={styles.noteComposer}>
          <textarea
            placeholder="Add an internal note…"
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
          />
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={addNote} disabled={!noteDraft.trim()}>
            Post note
          </button>
        </div>
        {notes.map((n) => (
          <div key={n.id} className={styles.noteCard}>
            <div className={styles.noteHead}>
              <span className={styles.noteUser}>{n.user_name || "User"}</span>
              <span className={styles.noteTime}>{new Date(n.created_at).toLocaleString()}</span>
            </div>
            <div className={styles.noteBody}>{n.note}</div>
            {n.user_id === user?.id ? (
              <button
                type="button"
                className={styles.smallBtn}
                style={{ marginTop: "0.25rem" }}
                onClick={() => deleteNote(n.id)}
              >Delete</button>
            ) : null}
          </div>
        ))}
      </div>
    </aside>
  );
}
