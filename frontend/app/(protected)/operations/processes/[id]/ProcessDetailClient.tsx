"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "../../operations.module.css";
import OperationsTopBar from "../../OperationsTopBar";
import { apiUrl } from "../../../../../lib/api";
import { useAuth } from "../../../../../context/AuthContext";
import type { ProcessRecord, ProcessStatus, ProcessStep, StepStatus, TeamUser } from "../../types";

function stepStatusClass(s: StepStatus): string {
  return styles[`status${s.charAt(0).toUpperCase() + s.slice(1).replace("_", "")}` as keyof typeof styles] ?? styles.statusPending;
}

function processStatusClass(s: ProcessStatus): string {
  return styles[`status${s.charAt(0).toUpperCase() + s.slice(1)}` as keyof typeof styles] ?? "";
}

export default function ProcessDetailClient({ processId }: { processId: string }) {
  const { authHeaders, token, isAdmin } = useAuth();
  const [processData, setProcessData] = useState<ProcessRecord | null>(null);
  const [steps, setSteps] = useState<ProcessStep[]>([]);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl(`/processes/${processId}`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(typeof body.error === "string" ? body.error : "Could not load process.");
      setProcessData(body.process);
      setSteps(body.steps || []);
      const firstPending = (body.steps || []).find(
        (s: ProcessStep) => s.status === "pending" || s.status === "in_progress"
      );
      if (firstPending) setExpandedStep(firstPending.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load process.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, processId]);

  const loadUsers = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl("/users"), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body.users)) setUsers(body.users);
    } catch {
      /* ignore */
    }
  }, [authHeaders, token]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const completeStep = async (step: ProcessStep) => {
    try {
      const res = await fetch(apiUrl(`/processes/steps/${step.id}/complete`), {
        method: "PUT",
        headers: { ...authHeaders() },
      });
      if (!res.ok) throw new Error("Could not complete step.");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not complete step.");
    }
  };

  const skipStep = async (step: ProcessStep) => {
    if (!confirm(`Skip step "${step.name}"?`)) return;
    try {
      const res = await fetch(apiUrl(`/processes/steps/${step.id}/skip`), {
        method: "PUT",
        headers: { ...authHeaders() },
      });
      if (!res.ok) throw new Error("Could not skip step.");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not skip step.");
    }
  };

  const assignStep = async (step: ProcessStep, userId: string) => {
    try {
      const res = await fetch(apiUrl(`/processes/steps/${step.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ assignedUserId: userId ? Number(userId) : null }),
      });
      if (!res.ok) throw new Error("Could not reassign.");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not reassign.");
    }
  };

  const changeProcessStatus = async (status: ProcessStatus) => {
    if (!processData) return;
    try {
      const res = await fetch(apiUrl(`/processes/${processData.id}/status`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Could not update status.");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not update status.");
    }
  };

  if (loading) {
    return (
      <div className={styles.page}>
        <OperationsTopBar />
        <div className={styles.main}>
          <div className={styles.loading}>Loading process…</div>
        </div>
      </div>
    );
  }

  if (!processData) {
    return (
      <div className={styles.page}>
        <OperationsTopBar />
        <div className={styles.main}>
          <div className={styles.errorBanner}>{err || "Process not found."}</div>
          <Link href="/operations/processes" className={`${styles.btn} ${styles.btnGhost}`}>
            ← Back to processes
          </Link>
        </div>
      </div>
    );
  }

  const total = steps.length;
  const done = steps.filter((s) => s.status === "completed" || s.status === "skipped").length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className={styles.page}>
      <OperationsTopBar />
      <div className={styles.main}>
        <Link
          href="/operations/processes"
          style={{ color: "#0098d0", textDecoration: "none", fontSize: "0.85rem", fontWeight: 600 }}
        >
          ← All processes
        </Link>
        <h2
          style={{
            margin: "0.75rem 0 1.25rem",
            color: "#1b2856",
            fontSize: "1.35rem",
            fontWeight: 700,
          }}
        >
          {processData.templateIcon ?? "📋"} {processData.name}
        </h2>

        {err ? <div className={styles.errorBanner}>{err}</div> : null}

        <div className={styles.processLayout}>
          <div>
            <div className={styles.sidebarCard} style={{ marginBottom: "1.25rem" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "1rem",
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "0.85rem", color: "#6a737b", marginBottom: "0.35rem" }}>
                    {done} of {total} steps complete ({pct}%)
                  </div>
                  <div className={styles.progressBar}>
                    <div className={styles.progressFill} style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <span className={`${styles.statusBadge} ${processStatusClass(processData.status)}`}>
                  {processData.status}
                </span>
              </div>
            </div>

            <div className={styles.timeline}>
              {steps.map((step) => {
                const isCompleted = step.status === "completed";
                const isSkipped = step.status === "skipped";
                const isBlocked = step.status === "blocked";
                const isExpanded = expandedStep === step.id;
                return (
                  <div
                    key={step.id}
                    className={`${styles.timelineStep} ${
                      isCompleted || isSkipped ? styles.timelineStepCompleted : ""
                    } ${step.status === "pending" || step.status === "in_progress" ? styles.timelineStepCurrent : ""}`}
                  >
                    <div
                      className={`${styles.stepNumber} ${
                        isCompleted || isSkipped
                          ? styles.stepNumberCompleted
                          : isBlocked
                          ? styles.stepNumberBlocked
                          : ""
                      }`}
                    >
                      {isCompleted ? "✓" : isSkipped ? "—" : isBlocked ? "🔒" : step.stepNumber}
                    </div>
                    <div className={styles.stepBody}>
                      <button
                        type="button"
                        style={{
                          background: "transparent",
                          border: "none",
                          padding: 0,
                          cursor: "pointer",
                          textAlign: "left",
                          width: "100%",
                          font: "inherit",
                        }}
                        onClick={() => setExpandedStep(isExpanded ? null : step.id)}
                      >
                        <h3
                          className={`${styles.stepName} ${
                            isCompleted || isSkipped ? styles.stepNameCompleted : ""
                          }`}
                        >
                          {step.name}
                        </h3>
                      </button>
                      <div className={styles.stepMeta}>
                        <span className={`${styles.statusBadge} ${stepStatusClass(step.status)}`}>
                          {step.status.replace("_", " ")}
                        </span>
                        {step.assignedUserName ? (
                          <span>👤 {step.assignedUserName}</span>
                        ) : step.assignedRole ? (
                          <span>👥 {step.assignedRole}</span>
                        ) : null}
                        {step.dueDate ? (
                          <span>📅 {new Date(step.dueDate).toLocaleDateString()}</span>
                        ) : null}
                        {isCompleted && step.completedByName ? (
                          <span>
                            by {step.completedByName} on{" "}
                            {step.completedAt
                              ? new Date(step.completedAt).toLocaleDateString()
                              : ""}
                          </span>
                        ) : null}
                      </div>
                      {isExpanded ? (
                        <div style={{ marginTop: "0.5rem" }}>
                          {step.description ? (
                            <p style={{ margin: "0 0 0.5rem", fontSize: "0.88rem" }}>
                              {step.description}
                            </p>
                          ) : null}
                          {!isCompleted && !isSkipped ? (
                            <div className={styles.stepActions}>
                              {!isBlocked ? (
                                <button
                                  type="button"
                                  className={`${styles.btn} ${styles.btnPrimary}`}
                                  onClick={() => completeStep(step)}
                                >
                                  ✓ Complete
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className={`${styles.btn} ${styles.btnGhost}`}
                                onClick={() => skipStep(step)}
                              >
                                Skip
                              </button>
                              <select
                                className={styles.select}
                                value={step.assignedUserId ?? ""}
                                onChange={(e) => assignStep(step, e.target.value)}
                              >
                                <option value="">Unassigned</option>
                                {users.map((u) => (
                                  <option key={u.id} value={u.id}>
                                    {u.displayName}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <aside>
            <div className={styles.sidebarCard}>
              <h3>Process details</h3>
              <div className={styles.sidebarRow}>
                <span className={styles.sidebarLabel}>Property</span>
                <span className={styles.sidebarValue}>{processData.propertyName ?? "—"}</span>
              </div>
              <div className={styles.sidebarRow}>
                <span className={styles.sidebarLabel}>Contact</span>
                <span className={styles.sidebarValue}>{processData.contactName ?? "—"}</span>
              </div>
              {processData.contactEmail ? (
                <div className={styles.sidebarRow}>
                  <span className={styles.sidebarLabel}>Email</span>
                  <span className={styles.sidebarValue}>{processData.contactEmail}</span>
                </div>
              ) : null}
              {processData.contactPhone ? (
                <div className={styles.sidebarRow}>
                  <span className={styles.sidebarLabel}>Phone</span>
                  <span className={styles.sidebarValue}>{processData.contactPhone}</span>
                </div>
              ) : null}
              <div className={styles.sidebarRow}>
                <span className={styles.sidebarLabel}>Started</span>
                <span className={styles.sidebarValue}>
                  {new Date(processData.startedAt).toLocaleDateString()}
                </span>
              </div>
              {processData.targetCompletion ? (
                <div className={styles.sidebarRow}>
                  <span className={styles.sidebarLabel}>Target</span>
                  <span className={styles.sidebarValue}>
                    {new Date(processData.targetCompletion).toLocaleDateString()}
                  </span>
                </div>
              ) : null}
              {processData.notes ? (
                <div style={{ marginTop: "0.65rem", fontSize: "0.85rem", color: "#333" }}>
                  {processData.notes}
                </div>
              ) : null}
            </div>
            <div className={styles.sidebarCard}>
              <h3>Actions</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {processData.status === "active" ? (
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnGhost}`}
                    onClick={() => changeProcessStatus("paused")}
                  >
                    ⏸ Pause
                  </button>
                ) : processData.status === "paused" ? (
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnPrimary}`}
                    onClick={() => changeProcessStatus("active")}
                  >
                    ▶ Resume
                  </button>
                ) : null}
                {processData.status !== "completed" ? (
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnGhost}`}
                    onClick={() => changeProcessStatus("completed")}
                  >
                    ✓ Mark complete
                  </button>
                ) : null}
                {processData.status !== "canceled" && isAdmin ? (
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnDanger}`}
                    onClick={() => {
                      if (confirm("Cancel this process?")) changeProcessStatus("canceled");
                    }}
                  >
                    Cancel process
                  </button>
                ) : null}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
