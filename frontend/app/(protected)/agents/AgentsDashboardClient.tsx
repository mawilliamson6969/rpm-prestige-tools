"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AgentsTopBar from "../../../components/AgentsTopBar";
import { useAuth } from "../../../context/AuthContext";
import { apiUrl } from "../../../lib/api";
import styles from "./agents.module.css";

type Agent = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  category: string;
  status: string;
  ownerDisplayName: string | null;
  triggerType: string;
  triggerConfig: Record<string, unknown> | null;
  icon: string;
  color: string;
  lastRunAt: string | null;
  pendingQueue?: number;
  actionsToday?: number;
  successApproxPercent?: number | null;
};

type Summary = {
  totalAgents: number;
  active: number;
  testing: number;
  paused: number;
  inactive: number;
  actionsToday: number;
  queuedForReview: number;
  successRatePercent: number | null;
};

function initials(name: string | null | undefined) {
  if (!name) return "?";
  const p = name.split(/\s+/).filter(Boolean);
  if (p.length >= 2) return (p[0][0] + p[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function triggerLabel(a: Agent) {
  const cfg = a.triggerConfig || {};
  if (typeof cfg.description === "string" && cfg.description) return cfg.description;
  if (a.triggerType === "manual") return "Manual only";
  if (typeof cfg.event === "string") return `On event: ${cfg.event}`;
  if (typeof cfg.cron === "string") return `Cron: ${cfg.cron}`;
  return a.triggerType;
}

function formatAgo(iso: string | null) {
  if (!iso) return "Never";
  const t = new Date(iso).getTime();
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function statusClass(s: string) {
  if (s === "active") return styles.statusActive;
  if (s === "testing") return styles.statusTesting;
  if (s === "paused") return styles.statusPaused;
  return styles.statusInactive;
}

export default function AgentsDashboardClient() {
  const { authHeaders, isAdmin, token } = useAuth();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [killOpen, setKillOpen] = useState(false);
  const [activateOpen, setActivateOpen] = useState<Agent | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [formName, setFormName] = useState("");
  const [formSlug, setFormSlug] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formCategory, setFormCategory] = useState("leasing");
  const [formIcon, setFormIcon] = useState("🤖");
  const [formColor, setFormColor] = useState("#0098D0");
  const [formTrigger, setFormTrigger] = useState<"schedule" | "event" | "manual">("schedule");
  const [formCronDesc, setFormCronDesc] = useState("Daily at 8:00 AM");
  const [formCron, setFormCron] = useState("0 8 * * *");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [ra, rs] = await Promise.all([
        fetch(apiUrl("/agents"), { cache: "no-store", headers: { ...authHeaders() } }),
        fetch(apiUrl("/agents/metrics/summary"), { cache: "no-store", headers: { ...authHeaders() } }),
      ]);
      const ba = await ra.json().catch(() => ({}));
      const bs = await rs.json().catch(() => ({}));
      if (!ra.ok) throw new Error(typeof ba.error === "string" ? ba.error : "Could not load agents.");
      if (!rs.ok) throw new Error(typeof bs.error === "string" ? bs.error : "Could not load summary.");
      setAgents(Array.isArray(ba.agents) ? ba.agents : []);
      setSummary(bs as Summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed.");
      setAgents([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token]);

  useEffect(() => {
    load();
  }, [load]);

  const autoSlug = useMemo(() => {
    return formName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 100);
  }, [formName]);

  useEffect(() => {
    if (createOpen) setFormSlug(autoSlug);
  }, [createOpen, autoSlug]);

  const setStatus = async (agent: Agent, status: string) => {
    setBusyId(agent.id);
    try {
      const res = await fetch(apiUrl(`/agents/${agent.id}/status`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ status }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Update failed.");
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setBusyId(null);
      setActivateOpen(null);
    }
  };

  const onActivateChoice = (mode: "testing" | "active") => {
    if (!activateOpen) return;
    void setStatus(activateOpen, mode);
  };

  const runTest = async (agent: Agent) => {
    setBusyId(agent.id);
    try {
      const res = await fetch(apiUrl(`/agents/${agent.id}/run`), {
        method: "POST",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Run failed.");
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Run failed.");
    } finally {
      setBusyId(null);
    }
  };

  const pauseAll = async () => {
    setBusyId(-1);
    try {
      const res = await fetch(apiUrl("/agents/emergency/pause-all"), {
        method: "POST",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Request failed.");
      setKillOpen(false);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusyId(null);
    }
  };

  const createAgent = async () => {
    setBusyId(-2);
    try {
      const slug = (formSlug || autoSlug).trim().toLowerCase();
      const res = await fetch(apiUrl("/agents"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          name: formName.trim(),
          slug,
          description: formDesc,
          category: formCategory,
          icon: formIcon,
          color: formColor,
          triggerType: formTrigger,
          triggerConfig:
            formTrigger === "schedule"
              ? { cron: formCron, description: formCronDesc }
              : formTrigger === "event"
                ? { event: "custom_event", description: "Custom event" }
                : { description: "Manual" },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Create failed.");
      setCreateOpen(false);
      setFormName("");
      setFormDesc("");
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Create failed.");
    } finally {
      setBusyId(null);
    }
  };

  const q = summary?.queuedForReview ?? 0;
  const sr =
    summary?.successRatePercent != null ? `${summary.successRatePercent}%` : "—";

  return (
    <div className={`${styles.page} ${styles.pageSans}`}>
      <AgentsTopBar />

      <main className={styles.main}>
        {error ? <div className={styles.errorBanner}>{error}</div> : null}

        <div className={styles.statsBar}>
          <span className={styles.statChip}>Total Agents: {summary?.totalAgents ?? "—"}</span>
          <span className={styles.statChip}>Active: {summary?.active ?? 0}</span>
          <span className={styles.statChip}>Testing: {summary?.testing ?? 0}</span>
          <span className={styles.statChip}>Paused: {summary?.paused ?? 0}</span>
          <span className={styles.statChipMuted}>Inactive: {summary?.inactive ?? "—"}</span>
          <span className={styles.statChip} style={{ marginLeft: "auto" }}>
            Actions Today: {summary?.actionsToday ?? 0}
          </span>
          <span className={styles.statChip}>Queued for Review: {q}</span>
          <span className={styles.statChip}>Success Rate: {sr}</span>
        </div>

        <div className={styles.quickRow}>
          <Link href="/agents/queue" className={`${styles.btn} ${styles.btnGhost}`}>
            Review Queue ({q})
          </Link>
          {isAdmin ? (
            <>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => setCreateOpen(true)}>
                Create Agent
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnDanger}`}
                onClick={() => setKillOpen(true)}
                disabled={busyId === -1}
              >
                Kill All Agents
              </button>
            </>
          ) : null}
        </div>

        {loading ? <p style={{ color: "var(--navy)" }}>Loading agents…</p> : null}

        <div className={styles.cardGrid}>
          {agents.map((a) => (
            <article key={a.id} className={styles.agentCard}>
              <div className={styles.cardHead}>
                <div className={styles.cardTitleRow}>
                  <span className={styles.cardIcon} aria-hidden>
                    {a.icon}
                  </span>
                  <h2 className={styles.cardTitle}>{a.name}</h2>
                </div>
                <span className={`${styles.statusBadge} ${statusClass(a.status)}`}>{a.status}</span>
              </div>
              <span className={styles.catBadge}>{a.category}</span>
              <p className={styles.desc}>{a.description || "—"}</p>
              <div className={styles.ownerRow}>
                <span
                  className={styles.avatarSm}
                  style={{ background: a.color || "#0098d0" }}
                  aria-hidden
                >
                  {initials(a.ownerDisplayName)}
                </span>
                <span>{a.ownerDisplayName || "Unassigned"}</span>
              </div>
              <div className={styles.metaRow}>
                Today: {a.actionsToday ?? 0} actions | Queue: {a.pendingQueue ?? 0} | Success:{" "}
                {a.successApproxPercent != null ? `${a.successApproxPercent}%` : "—"}
              </div>
              <div className={styles.metaRow}>
                Trigger: {triggerLabel(a)}
                <br />
                Last run: {formatAgo(a.lastRunAt)}
              </div>
              <div className={styles.actionsRow}>
                {isAdmin ? (
                  <>
                    {a.status === "inactive" || a.status === "paused" ? (
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`}
                        disabled={busyId === a.id}
                        onClick={() => setActivateOpen(a)}
                      >
                        {a.status === "paused" ? "Resume" : "Activate"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                        disabled={busyId === a.id}
                        onClick={() => void setStatus(a, "paused")}
                      >
                        Pause
                      </button>
                    )}
                    {(a.status === "active" || a.status === "testing") && isAdmin ? (
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                        disabled={busyId === a.id}
                        onClick={() => void runTest(a)}
                      >
                        Test Run
                      </button>
                    ) : null}
                  </>
                ) : null}
                <Link href={`/agents/${a.slug}`} className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}>
                  Configure
                </Link>
              </div>
            </article>
          ))}
        </div>
      </main>

      {activateOpen ? (
        <div className={styles.modalOverlay} role="dialog" aria-modal>
          <div className={styles.modal}>
            <h2>Activate agent</h2>
            <p style={{ fontSize: "0.9rem", color: "#444" }}>
              Activating <strong>{activateOpen.name}</strong> will allow it to take automated actions. Start in Testing
              mode first? (Testing queues all actions for review.)
            </p>
            <div className={styles.modalActions}>
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setActivateOpen(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGhost}`}
                onClick={() => onActivateChoice("active")}
              >
                Activate anyway
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => onActivateChoice("testing")}>
                Use Testing mode
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {killOpen ? (
        <div className={styles.modalOverlay} role="dialog" aria-modal>
          <div className={styles.modal}>
            <h2>Emergency pause</h2>
            <p style={{ fontSize: "0.9rem", color: "#444" }}>
              This will immediately pause all active agents. Continue?
            </p>
            <div className={styles.modalActions}>
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setKillOpen(false)}>
                Cancel
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={() => void pauseAll()}>
                Pause all active agents
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {createOpen ? (
        <div className={styles.modalOverlay} role="dialog" aria-modal>
          <div className={styles.modal}>
            <h2>Create agent</h2>
            <p style={{ fontSize: "0.82rem", color: "#666" }}>New agents are created as Inactive.</p>
            <div className={styles.field}>
              <label htmlFor="aname">Name</label>
              <input id="aname" value={formName} onChange={(e) => setFormName(e.target.value)} />
            </div>
            <div className={styles.field}>
              <label htmlFor="aslug">Slug</label>
              <input id="aslug" value={formSlug} onChange={(e) => setFormSlug(e.target.value)} placeholder={autoSlug} />
            </div>
            <div className={styles.field}>
              <label htmlFor="adesc">Description</label>
              <textarea id="adesc" value={formDesc} onChange={(e) => setFormDesc(e.target.value)} />
            </div>
            <div className={styles.field}>
              <label htmlFor="acat">Category</label>
              <select id="acat" value={formCategory} onChange={(e) => setFormCategory(e.target.value)}>
                {[
                  "leasing",
                  "maintenance",
                  "accounting",
                  "client-success",
                  "communications",
                  "reporting",
                  "general",
                  "other",
                ].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="aicon">Icon (emoji)</label>
              <input id="aicon" value={formIcon} onChange={(e) => setFormIcon(e.target.value)} maxLength={10} />
            </div>
            <div className={styles.field}>
              <label htmlFor="acolor">Color</label>
              <input id="acolor" type="color" value={formColor} onChange={(e) => setFormColor(e.target.value)} />
            </div>
            <div className={styles.field}>
              <label htmlFor="atrig">Trigger</label>
              <select
                id="atrig"
                value={formTrigger}
                onChange={(e) => setFormTrigger(e.target.value as typeof formTrigger)}
              >
                <option value="schedule">Schedule</option>
                <option value="event">Event</option>
                <option value="manual">Manual</option>
              </select>
            </div>
            {formTrigger === "schedule" ? (
              <>
                <div className={styles.field}>
                  <label htmlFor="acron">Cron expression</label>
                  <input id="acron" value={formCron} onChange={(e) => setFormCron(e.target.value)} />
                </div>
                <div className={styles.field}>
                  <label htmlFor="acrond">Human-readable schedule</label>
                  <input id="acrond" value={formCronDesc} onChange={(e) => setFormCronDesc(e.target.value)} />
                </div>
              </>
            ) : null}
            <div className={styles.modalActions}>
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setCreateOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                disabled={!formName.trim() || busyId === -2}
                onClick={() => void createAgent()}
              >
                Create as Inactive
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
