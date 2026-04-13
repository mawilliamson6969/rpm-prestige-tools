"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import AgentsTopBar from "../../../../components/AgentsTopBar";
import { useAuth } from "../../../../context/AuthContext";
import { apiUrl } from "../../../../lib/api";
import { simpleLineDiff } from "../../../../lib/agentTextDiff";
import { buildCronExpression, humanDescription, type CronPreset } from "../../../../lib/agentsCron";
import styles from "../agents.module.css";
import AgentPerformancePanel, { type MetricRow } from "./AgentPerformancePanel";

type Agent = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  category: string;
  status: string;
  ownerUserId: number | null;
  ownerDisplayName: string | null;
  triggerType: string;
  triggerConfig: Record<string, unknown> | null;
  systemPrompt: string | null;
  systemPromptVersion: number;
  guardrails: { never?: string[]; always?: string[]; escalate?: string[] } | null;
  confidenceThreshold: number;
  dailyActionLimit: number;
  dataSources: string[];
  icon: string;
  color: string;
  updatedAt: string | null;
};

type TeamUser = { id: number; displayName: string };

type TabId = "overview" | "prompt" | "guardrails" | "activity" | "queue" | "performance";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "prompt", label: "AI Prompt" },
  { id: "guardrails", label: "Guardrails" },
  { id: "activity", label: "Activity Log" },
  { id: "queue", label: "Queue" },
  { id: "performance", label: "Performance" },
];

const DATA_OPTIONS = [
  { key: "appfolio", label: "AppFolio" },
  { key: "rentengine", label: "RentEngine" },
  { key: "boom", label: "Boom" },
  { key: "leadsimple", label: "LeadSimple" },
  { key: "outlook", label: "Outlook" },
] as const;

const EVENT_OPTIONS = [
  { value: "new_work_order", label: "New work order synced" },
  { value: "new_email_ticket", label: "New email ticket classified" },
  { value: "new_lead", label: "New lead" },
  { value: "custom_event", label: "Custom event" },
];

function toYMD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function statusClass(s: string) {
  if (s === "active") return styles.statusActive;
  if (s === "testing") return styles.statusTesting;
  if (s === "paused") return styles.statusPaused;
  return styles.statusInactive;
}

function confClass(n: number | null | undefined) {
  if (n == null) return "";
  if (n > 85) return styles.confHigh;
  if (n >= 60) return styles.confMid;
  return styles.confLow;
}

export default function AgentDetailClient() {
  const params = useParams();
  const slug = typeof params?.slug === "string" ? params.slug : "";
  const router = useRouter();
  const searchParams = useSearchParams();
  const { authHeaders, isAdmin, token } = useAuth();

  const initialTab = (searchParams.get("tab") as TabId) || "overview";
  const [tab, setTab] = useState<TabId>(TABS.some((t) => t.id === initialTab) ? initialTab : "overview");

  const [agent, setAgent] = useState<Agent | null>(null);
  const [team, setTeam] = useState<TeamUser[]>([]);
  const [promptBody, setPromptBody] = useState("");
  const [promptNotes, setPromptNotes] = useState("");
  const [versions, setVersions] = useState<
    { versionNumber: number; systemPrompt: string; changeNotes: string | null; changedByName: string | null; createdAt: string }[]
  >([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testInput, setTestInput] = useState("");
  const [testOut, setTestOut] = useState<string | null>(null);
  const [training, setTraining] = useState<
    { id: number; exampleType: string; inputContext: string; agentResponse: string; humanCorrectedResponse: string | null }[]
  >([]);
  const [never, setNever] = useState<string[]>([]);
  const [always, setAlways] = useState<string[]>([]);
  const [escalate, setEscalate] = useState<string[]>([]);

  const [nameEdit, setNameEdit] = useState("");
  const [descEdit, setDescEdit] = useState("");
  const [iconEdit, setIconEdit] = useState("");
  const [colorEdit, setColorEdit] = useState("");
  const [ownerEdit, setOwnerEdit] = useState<number | "">("");
  const [confThreshold, setConfThreshold] = useState(85);
  const [dailyLimit, setDailyLimit] = useState(50);
  const [dataSrc, setDataSrc] = useState<string[]>([]);
  const [triggerType, setTriggerType] = useState<"schedule" | "event" | "manual">("schedule");
  const [cronPreset, setCronPreset] = useState<CronPreset>("daily");
  const [everyMin, setEveryMin] = useState(15);
  const [cronHour, setCronHour] = useState(8);
  const [cronMinute, setCronMinute] = useState(0);
  const [cronWeekday, setCronWeekday] = useState(1);
  const [eventType, setEventType] = useState("new_work_order");
  const [eventDesc, setEventDesc] = useState("");

  const [activity, setActivity] = useState<{ total: number; items: Record<string, unknown>[] }>({
    total: 0,
    items: [],
  });
  const [actOffset, setActOffset] = useState(0);
  const [actReload, setActReload] = useState(0);
  const [actResult, setActResult] = useState("");
  const [actFeedback, setActFeedback] = useState("");
  const [actStart, setActStart] = useState("");
  const [actEnd, setActEnd] = useState("");
  const [actMinC, setActMinC] = useState("");
  const [actMaxC, setActMaxC] = useState("");

  const [queue, setQueue] = useState<Record<string, unknown>[]>([]);
  const [metrics, setMetrics] = useState<MetricRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);
  const [expandedAct, setExpandedAct] = useState<number | null>(null);

  const [newExType, setNewExType] = useState<"good" | "bad">("good");
  const [newExIn, setNewExIn] = useState("");
  const [newExOut, setNewExOut] = useState("");
  const [newExFix, setNewExFix] = useState("");
  const [newExNotes, setNewExNotes] = useState("");

  const [editQ, setEditQ] = useState<{ id: number; text: string } | null>(null);
  const [rejectQ, setRejectQ] = useState<{ id: number; notes: string } | null>(null);

  const applyAgent = useCallback((a: Agent) => {
    setAgent((prev) => ({
      ...a,
      ownerDisplayName: a.ownerDisplayName ?? prev?.ownerDisplayName ?? null,
    }));
    setNameEdit(a.name);
    setDescEdit(a.description || "");
    setIconEdit(a.icon);
    setColorEdit(a.color);
    setOwnerEdit(a.ownerUserId ?? "");
    setPromptBody(a.systemPrompt || "");
    setConfThreshold(a.confidenceThreshold);
    setDailyLimit(a.dailyActionLimit);
    setDataSrc(Array.isArray(a.dataSources) ? [...a.dataSources] : []);
    const g = a.guardrails || {};
    setNever([...(g.never || [])]);
    setAlways([...(g.always || [])]);
    setEscalate([...(g.escalate || [])]);
    const tt = a.triggerType === "event" || a.triggerType === "manual" ? a.triggerType : "schedule";
    setTriggerType(tt);
    const cfg = a.triggerConfig || {};
    if (tt === "event") {
      setEventType(typeof cfg.event === "string" ? cfg.event : "new_work_order");
      setEventDesc(typeof cfg.description === "string" ? cfg.description : "");
    }
    if (tt === "schedule" && typeof cfg.cron === "string") {
      setCronPreset("daily");
    }
  }, []);

  const load = useCallback(async () => {
    if (!token || !slug) return;
    setLoading(true);
    setError(null);
    try {
      const [rAgent, rTeam] = await Promise.all([
        fetch(apiUrl(`/agents/${encodeURIComponent(slug)}`), { cache: "no-store", headers: { ...authHeaders() } }),
        fetch(apiUrl("/eos/team-users"), { cache: "no-store", headers: { ...authHeaders() } }),
      ]);
      const bAgent = await rAgent.json().catch(() => ({}));
      const bTeam = await rTeam.json().catch(() => ({}));
      if (!rAgent.ok) throw new Error(typeof bAgent.error === "string" ? bAgent.error : "Not found.");
      const a = bAgent.agent as Agent;
      if (!a) throw new Error("Agent not found.");
      applyAgent(a);
      if (rTeam.ok && Array.isArray(bTeam.users)) {
        setTeam(bTeam.users.map((u: { id: number; displayName: string }) => ({ id: u.id, displayName: u.displayName })));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      setAgent(null);
    } finally {
      setLoading(false);
    }
  }, [applyAgent, authHeaders, slug, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadSecondary = useCallback(async () => {
    if (!token || !agent) return;
    const id = agent.id;
    try {
      const [rp, rt, rq, rm] = await Promise.all([
        fetch(apiUrl(`/agents/${id}/prompts`), { headers: { ...authHeaders() } }),
        fetch(apiUrl(`/agents/${id}/training`), { headers: { ...authHeaders() } }),
        fetch(apiUrl(`/agents/${id}/queue`), { headers: { ...authHeaders() } }),
        fetch(apiUrl(`/agents/${id}/metrics`), { headers: { ...authHeaders() } }),
      ]);
      const [bp, bt, bq, bm] = await Promise.all([
        rp.json().catch(() => ({})),
        rt.json().catch(() => ({})),
        rq.json().catch(() => ({})),
        rm.json().catch(() => ({})),
      ]);
      if (rp.ok && Array.isArray(bp.versions)) setVersions(bp.versions);
      if (rt.ok && Array.isArray(bt.examples)) setTraining(bt.examples);
      if (rq.ok && Array.isArray(bq.items)) setQueue(bq.items);
      if (rm.ok && Array.isArray(bm.metrics)) setMetrics(bm.metrics);
    } catch {
      /* ignore */
    }
  }, [agent, authHeaders, token]);

  useEffect(() => {
    if (agent) void loadSecondary();
  }, [agent, loadSecondary]);

  const loadActivity = useCallback(async () => {
    if (!token || !agent) return;
    const q = new URLSearchParams();
    q.set("limit", "20");
    q.set("offset", String(actOffset));
    if (actResult) q.set("result", actResult);
    if (actFeedback) q.set("humanFeedback", actFeedback);
    if (actStart) q.set("startDate", actStart);
    if (actEnd) q.set("endDate", actEnd);
    if (actMinC) q.set("minConfidence", actMinC);
    if (actMaxC) q.set("maxConfidence", actMaxC);
    const res = await fetch(apiUrl(`/agents/${agent.id}/activity?${q}`), { headers: { ...authHeaders() } });
    const body = await res.json().catch(() => ({}));
    if (res.ok) setActivity({ total: body.total ?? 0, items: body.items ?? [] });
  }, [actEnd, actFeedback, actMaxC, actMinC, actOffset, actReload, actResult, actStart, agent, authHeaders, token]);

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  const saveOverview = async () => {
    if (!agent || !isAdmin) return;
    setBusy(true);
    try {
      const cron = buildCronExpression({
        preset: cronPreset,
        everyMinutes: everyMin,
        hour: cronHour,
        minute: cronMinute,
        weekday: cronWeekday,
      });
      const desc =
        triggerType === "schedule"
          ? humanDescription({
              preset: cronPreset,
              everyMinutes: everyMin,
              hour: cronHour,
              minute: cronMinute,
              weekday: cronWeekday,
            })
          : triggerType === "event"
            ? eventDesc || EVENT_OPTIONS.find((e) => e.value === eventType)?.label || "Event"
            : "Manual";
      const triggerConfig =
        triggerType === "schedule"
          ? { cron, description: desc }
          : triggerType === "event"
            ? { event: eventType, description: desc }
            : { description: "Manual" };
      const res = await fetch(apiUrl(`/agents/${agent.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          name: nameEdit.trim(),
          description: descEdit,
          icon: iconEdit,
          color: colorEdit,
          ownerUserId: ownerEdit === "" ? null : ownerEdit,
          confidenceThreshold: confThreshold,
          dailyActionLimit: dailyLimit,
          dataSources: dataSrc,
          triggerType,
          triggerConfig,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Save failed.");
      applyAgent(body.agent);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const saveGuardrails = async () => {
    if (!agent || !isAdmin) return;
    setBusy(true);
    try {
      const res = await fetch(apiUrl(`/agents/${agent.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          guardrails: { never, always, escalate },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Save failed.");
      applyAgent(body.agent);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const savePrompt = async () => {
    if (!agent || !isAdmin) return;
    if (!promptNotes.trim()) {
      alert("Change notes are required.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(apiUrl(`/agents/${agent.id}/prompts`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ systemPrompt: promptBody, changeNotes: promptNotes }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Save failed.");
      applyAgent(body.agent);
      setPromptNotes("");
      const rp = await fetch(apiUrl(`/agents/${agent.id}/prompts`), { headers: { ...authHeaders() } });
      const bp = await rp.json().catch(() => ({}));
      if (rp.ok && Array.isArray(bp.versions)) setVersions(bp.versions);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const restoreVersion = async (v: number) => {
    if (!agent || !isAdmin) return;
    setBusy(true);
    try {
      const res = await fetch(apiUrl(`/agents/${agent.id}/prompts/${v}/restore`), {
        method: "POST",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Restore failed.");
      const next = body.agent as Agent;
      applyAgent(next);
      setPromptBody(next.systemPrompt || "");
      const rp = await fetch(apiUrl(`/agents/${agent.id}/prompts`), { headers: { ...authHeaders() } });
      const bp = await rp.json().catch(() => ({}));
      if (rp.ok && Array.isArray(bp.versions)) setVersions(bp.versions);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Restore failed.");
    } finally {
      setBusy(false);
    }
  };

  const runTestPrompt = async () => {
    if (!agent) return;
    setBusy(true);
    setTestOut(null);
    try {
      const res = await fetch(apiUrl(`/agents/${agent.id}/test-prompt`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ sampleTrigger: testInput }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Test failed.");
      setTestOut(typeof body.output === "string" ? body.output : "");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Test failed.");
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status: string) => {
    if (!agent) return;
    setBusy(true);
    try {
      const res = await fetch(apiUrl(`/agents/${agent.id}/status`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ status }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Failed.");
      applyAgent(body.agent);
      setActivateOpen(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  const addTraining = async () => {
    if (!agent || !isAdmin) return;
    setBusy(true);
    try {
      const res = await fetch(apiUrl(`/agents/${agent.id}/training`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          exampleType: newExType,
          inputContext: newExIn,
          agentResponse: newExOut,
          humanCorrectedResponse: newExFix || null,
          correctionNotes: newExNotes || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Failed.");
      setNewExIn("");
      setNewExOut("");
      setNewExFix("");
      setNewExNotes("");
      const rt = await fetch(apiUrl(`/agents/${agent.id}/training`), { headers: { ...authHeaders() } });
      const bt = await rt.json().catch(() => ({}));
      if (rt.ok && Array.isArray(bt.examples)) setTraining(bt.examples);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  const delTraining = async (exId: number) => {
    if (!agent || !isAdmin) return;
    setBusy(true);
    try {
      const res = await fetch(apiUrl(`/agents/${agent.id}/training/${exId}`), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.error === "string" ? body.error : "Failed.");
      }
      setTraining((t) => t.filter((x) => x.id !== exId));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  const metrics30 = useMemo(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return metrics.filter((m) => m.metricDate >= toYMD(start) && m.metricDate <= toYMD(end));
  }, [metrics]);

  const tabFromUrl = searchParams.get("tab");
  useEffect(() => {
    const t = tabFromUrl as TabId;
    if (TABS.some((x) => x.id === t)) setTab(t);
  }, [tabFromUrl]);

  if (loading) {
    return (
      <div className={`${styles.page} ${styles.pageSans}`}>
        <AgentsTopBar title="Agent" />
        <main className={styles.main}>
          <p>Loading…</p>
        </main>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className={`${styles.page} ${styles.pageSans}`}>
        <AgentsTopBar title="Agent" />
        <main className={styles.main}>
          <div className={styles.errorBanner}>{error || "Not found."}</div>
          <Link href="/agents">← Back to agents</Link>
        </main>
      </div>
    );
  }

  return (
    <div className={`${styles.page} ${styles.pageSans}`}>
      <AgentsTopBar title={agent.name} subtitle="Agent configuration" />

      <main className={styles.main}>
        <p style={{ marginBottom: "0.75rem" }}>
          <Link href="/agents" className={styles.backLink}>
            ← All agents
          </Link>
        </p>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
          <span style={{ fontSize: "2rem" }} aria-hidden>
            {agent.icon}
          </span>
          <span className={`${styles.statusBadge} ${statusClass(agent.status)}`}>{agent.status}</span>
        </div>

        <select
          className={styles.tabSelect}
          aria-label="Section"
          value={tab}
          onChange={(e) => setTab(e.target.value as TabId)}
        >
          {TABS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>

        <div className={styles.tabBar} role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              className={`${styles.tabBtn} ${tab === t.id ? styles.tabBtnActive : ""}`}
              onClick={() => {
                setTab(t.id);
                router.replace(`/agents/${slug}${t.id === "overview" ? "" : `?tab=${t.id}`}`, { scroll: false });
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "overview" ? (
          <section className={styles.panel}>
            <h3>Identity</h3>
            <div className={styles.field}>
              <label>Name</label>
              <input value={nameEdit} onChange={(e) => setNameEdit(e.target.value)} disabled={!isAdmin} />
            </div>
            <div className={styles.field}>
              <label>Description</label>
              <textarea value={descEdit} onChange={(e) => setDescEdit(e.target.value)} disabled={!isAdmin} />
            </div>
            <div className={styles.field}>
              <label>Icon</label>
              <input value={iconEdit} onChange={(e) => setIconEdit(e.target.value)} disabled={!isAdmin} />
            </div>
            <div className={styles.field}>
              <label>Color</label>
              <input type="color" value={colorEdit} onChange={(e) => setColorEdit(e.target.value)} disabled={!isAdmin} />
            </div>

            <h3>Status</h3>
            <p style={{ fontSize: "0.82rem", color: "#555" }}>
              Testing: runs but queues all actions. Active: above-threshold auto-executes (when engine is connected).
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              {(["inactive", "testing", "active", "paused"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`${styles.btn} ${styles.btnGhost} ${agent.status === s ? styles.tabBtnActive : ""}`}
                  disabled={!isAdmin || busy}
                  onClick={() => {
                    if (s === "active" && agent.status !== "active") {
                      setActivateOpen(true);
                      return;
                    }
                    void setStatus(s);
                  }}
                >
                  {s}
                </button>
              ))}
            </div>

            <h3 style={{ marginTop: "1rem" }}>Trigger</h3>
            <div className={styles.field}>
              <label>Type</label>
              <select
                value={triggerType}
                disabled={!isAdmin}
                onChange={(e) => setTriggerType(e.target.value as typeof triggerType)}
              >
                <option value="schedule">Schedule</option>
                <option value="event">Event</option>
                <option value="manual">Manual</option>
              </select>
            </div>
            {triggerType === "schedule" ? (
              <>
                <div className={styles.field}>
                  <label>Frequency</label>
                  <select
                    value={cronPreset}
                    disabled={!isAdmin}
                    onChange={(e) => setCronPreset(e.target.value as CronPreset)}
                  >
                    <option value="minutes">Every N minutes</option>
                    <option value="hourly">Hourly</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </div>
                {cronPreset === "minutes" ? (
                  <div className={styles.field}>
                    <label>Every (minutes)</label>
                    <input
                      type="number"
                      min={1}
                      max={59}
                      value={everyMin}
                      disabled={!isAdmin}
                      onChange={(e) => setEveryMin(Number(e.target.value))}
                    />
                  </div>
                ) : null}
                {cronPreset === "hourly" || cronPreset === "daily" || cronPreset === "weekly" ? (
                  <div className={styles.field}>
                    <label>Time (local)</label>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <input
                        type="number"
                        min={0}
                        max={23}
                        value={cronHour}
                        disabled={!isAdmin}
                        onChange={(e) => setCronHour(Number(e.target.value))}
                        aria-label="Hour"
                      />
                      <input
                        type="number"
                        min={0}
                        max={59}
                        value={cronMinute}
                        disabled={!isAdmin}
                        onChange={(e) => setCronMinute(Number(e.target.value))}
                        aria-label="Minute"
                      />
                    </div>
                  </div>
                ) : null}
                {cronPreset === "weekly" ? (
                  <div className={styles.field}>
                    <label>Weekday (0=Sun)</label>
                    <input
                      type="number"
                      min={0}
                      max={7}
                      value={cronWeekday}
                      disabled={!isAdmin}
                      onChange={(e) => setCronWeekday(Number(e.target.value))}
                    />
                  </div>
                ) : null}
                <p style={{ fontSize: "0.8rem", color: "#666" }}>
                  Preview: {humanDescription({ preset: cronPreset, everyMinutes: everyMin, hour: cronHour, minute: cronMinute, weekday: cronWeekday })}{" "}
                  · <code>{buildCronExpression({ preset: cronPreset, everyMinutes: everyMin, hour: cronHour, minute: cronMinute, weekday: cronWeekday })}</code>
                </p>
              </>
            ) : null}
            {triggerType === "event" ? (
              <>
                <div className={styles.field}>
                  <label>Event</label>
                  <select value={eventType} disabled={!isAdmin} onChange={(e) => setEventType(e.target.value)}>
                    {EVENT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label>Description</label>
                  <input value={eventDesc} onChange={(e) => setEventDesc(e.target.value)} disabled={!isAdmin} />
                </div>
              </>
            ) : null}

            <h3 style={{ marginTop: "1rem" }}>Confidence & limits</h3>
            <div className={styles.field}>
              <label>Confidence threshold ({confThreshold})</label>
              <input
                type="range"
                min={0}
                max={100}
                value={confThreshold}
                disabled={!isAdmin}
                onChange={(e) => setConfThreshold(Number(e.target.value))}
              />
              <p style={{ fontSize: "0.78rem", color: "#555" }}>
                Actions with confidence above this threshold will auto-execute when the agent is Active. Below this
                threshold, actions are queued for human review.
              </p>
            </div>
            <div className={styles.field}>
              <label>Daily action limit</label>
              <input
                type="number"
                min={0}
                value={dailyLimit}
                disabled={!isAdmin}
                onChange={(e) => setDailyLimit(Number(e.target.value))}
              />
              <p style={{ fontSize: "0.78rem", color: "#555" }}>Maximum automated actions per day (safety cap).</p>
            </div>

            <h3 style={{ marginTop: "1rem" }}>Data sources</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              {DATA_OPTIONS.map((d) => (
                <label key={d.key} style={{ fontSize: "0.88rem", display: "flex", gap: "0.35rem", alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={dataSrc.includes(d.key)}
                    disabled={!isAdmin}
                    onChange={(e) => {
                      if (e.target.checked) setDataSrc([...dataSrc, d.key]);
                      else setDataSrc(dataSrc.filter((x) => x !== d.key));
                    }}
                  />
                  {d.label}
                </label>
              ))}
            </div>

            <h3 style={{ marginTop: "1rem" }}>Owner / supervisor</h3>
            <div className={styles.field}>
              <label>Team member</label>
              <select
                value={ownerEdit === "" ? "" : String(ownerEdit)}
                disabled={!isAdmin}
                onChange={(e) => setOwnerEdit(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">— Unassigned —</option>
                {team.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                  </option>
                ))}
              </select>
            </div>

            {isAdmin ? (
              <div className={styles.modalActions} style={{ marginTop: "1rem" }}>
                <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy} onClick={() => void saveOverview()}>
                  Save overview
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {tab === "prompt" ? (
          <section className={styles.panel}>
            <h3>System prompt</h3>
            <p style={{ fontSize: "0.82rem", color: "#555" }}>
              Version {agent.systemPromptVersion}
              {agent.updatedAt
                ? ` · last updated ${new Date(agent.updatedAt).toLocaleString()}`
                : ""}
            </p>
            <textarea className={styles.promptArea} value={promptBody} onChange={(e) => setPromptBody(e.target.value)} disabled={!isAdmin} />
            <div className={styles.field}>
              <label>Change notes (required to save)</label>
              <input value={promptNotes} onChange={(e) => setPromptNotes(e.target.value)} disabled={!isAdmin} />
            </div>
            {isAdmin ? (
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy} onClick={() => void savePrompt()}>
                Save prompt
              </button>
            ) : null}

            <div className={styles.collapsible}>
              <details open={historyOpen} onToggle={(e) => setHistoryOpen((e.target as HTMLDetailsElement).open)}>
                <summary>Version history</summary>
                {versions.map((v, idx) => {
                  const older = versions[idx + 1];
                  const diff = older ? simpleLineDiff(older.systemPrompt, v.systemPrompt) : "";
                  return (
                    <div key={v.versionNumber} style={{ marginTop: "0.75rem", borderTop: "1px solid #eee", paddingTop: "0.5rem" }}>
                      <strong>v{v.versionNumber}</strong>{" "}
                      <span style={{ color: "#666", fontSize: "0.8rem" }}>
                        {v.changeNotes} · {v.changedByName || "—"}
                      </span>
                      {older ? <pre className={styles.diffBlock}>{diff}</pre> : null}
                      {isAdmin ? (
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                          disabled={busy}
                          onClick={() => void restoreVersion(v.versionNumber)}
                        >
                          Restore this version
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </details>
            </div>

            <button type="button" className={`${styles.btn} ${styles.btnGhost}`} style={{ marginTop: "0.75rem" }} onClick={() => setTestOpen(true)}>
              Test prompt
            </button>

            <h3 style={{ marginTop: "1.25rem" }}>Training examples</h3>
            <p style={{ fontSize: "0.8rem", color: "#555" }}>
              Good and bad examples are appended to the system prompt when the agent runs.
            </p>
            {training.map((ex) => (
              <div
                key={ex.id}
                style={{
                  border: `2px solid ${ex.exampleType === "bad" ? "#b32317" : "#1a7f4c"}`,
                  borderRadius: 10,
                  padding: "0.65rem",
                  marginBottom: "0.5rem",
                  fontSize: "0.85rem",
                }}
              >
                <strong>{ex.exampleType === "bad" ? "Bad" : "Good"}</strong>
                <div style={{ marginTop: "0.35rem" }}>
                  <em>Input</em>
                  <pre style={{ margin: "0.25rem 0", whiteSpace: "pre-wrap" }}>{ex.inputContext}</pre>
                  <em>Response</em>
                  <pre style={{ margin: "0.25rem 0", whiteSpace: "pre-wrap" }}>{ex.agentResponse}</pre>
                  {ex.humanCorrectedResponse ? (
                    <>
                      <em>Correction</em>
                      <pre style={{ margin: "0.25rem 0", whiteSpace: "pre-wrap" }}>{ex.humanCorrectedResponse}</pre>
                    </>
                  ) : null}
                  {isAdmin ? (
                    <button type="button" className={`${styles.btn} ${styles.btnDanger} ${styles.btnSm}`} onClick={() => void delTraining(ex.id)}>
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
            {isAdmin ? (
              <div style={{ marginTop: "0.75rem", borderTop: "1px solid #eee", paddingTop: "0.75rem" }}>
                <h4>Add example</h4>
                <div className={styles.field}>
                  <label>Type</label>
                  <select value={newExType} onChange={(e) => setNewExType(e.target.value as "good" | "bad")}>
                    <option value="good">Good</option>
                    <option value="bad">Bad</option>
                  </select>
                </div>
                <div className={styles.field}>
                  <label>Input context</label>
                  <textarea value={newExIn} onChange={(e) => setNewExIn(e.target.value)} />
                </div>
                <div className={styles.field}>
                  <label>Agent response</label>
                  <textarea value={newExOut} onChange={(e) => setNewExOut(e.target.value)} />
                </div>
                <div className={styles.field}>
                  <label>Human corrected (if bad)</label>
                  <textarea value={newExFix} onChange={(e) => setNewExFix(e.target.value)} />
                </div>
                <div className={styles.field}>
                  <label>Notes</label>
                  <input value={newExNotes} onChange={(e) => setNewExNotes(e.target.value)} />
                </div>
                <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy} onClick={() => void addTraining()}>
                  Add example
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {tab === "guardrails" ? (
          <section className={styles.panel}>
            <h3>Guardrails</h3>
            <p style={{ fontSize: "0.82rem", color: "#555" }}>These lists are injected into the system prompt when the agent runs.</p>
            <div className={`${styles.guardSection} ${styles.guardNever}`}>
              <strong>Never</strong>
              <GuardList items={never} setItems={setNever} disabled={!isAdmin} />
            </div>
            <div className={`${styles.guardSection} ${styles.guardAlways}`}>
              <strong>Always</strong>
              <GuardList items={always} setItems={setAlways} disabled={!isAdmin} />
            </div>
            <div className={`${styles.guardSection} ${styles.guardEscalate}`}>
              <strong>Escalate when</strong>
              <GuardList items={escalate} setItems={setEscalate} disabled={!isAdmin} />
            </div>
            {isAdmin ? (
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy} onClick={() => void saveGuardrails()}>
                Save guardrails
              </button>
            ) : null}
          </section>
        ) : null}

        {tab === "activity" ? (
          <section className={styles.panel}>
            <h3>Activity log</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
              <input type="date" value={actStart} onChange={(e) => setActStart(e.target.value)} aria-label="Start date" />
              <input type="date" value={actEnd} onChange={(e) => setActEnd(e.target.value)} aria-label="End date" />
              <select value={actResult} onChange={(e) => setActResult(e.target.value)}>
                <option value="">All results</option>
                <option value="success">Success</option>
                <option value="failed">Failed</option>
                <option value="queued">Queued</option>
                <option value="human_override">Human override</option>
                <option value="pending">Pending</option>
              </select>
              <select value={actFeedback} onChange={(e) => setActFeedback(e.target.value)}>
                <option value="">All feedback</option>
                <option value="good">Good</option>
                <option value="needs_improvement">Needs improvement</option>
              </select>
              <input placeholder="Min conf" value={actMinC} onChange={(e) => setActMinC(e.target.value)} style={{ width: 80 }} />
              <input placeholder="Max conf" value={actMaxC} onChange={(e) => setActMaxC(e.target.value)} style={{ width: 80 }} />
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                onClick={() => {
                  setActOffset(0);
                  setActReload((n) => n + 1);
                }}
              >
                Apply filters
              </button>
            </div>
            {activity.items.map((row) => {
              const r = row as Record<string, unknown>;
              const id = r.id as number;
              const open = expandedAct === id;
              return (
                <div key={id} className={styles.logRow}>
                  <div className={styles.logTime}>{new Date(String(r.createdAt)).toLocaleString()}</div>
                  <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.75rem" }}>
                    {String(r.triggerEvent || "")} → {String(r.decision || "")} → {String(r.actionTaken || "")}{" "}
                    <span className={confClass(typeof r.confidenceScore === "number" ? r.confidenceScore : null)}>
                      {typeof r.confidenceScore === "number" ? r.confidenceScore : "—"}
                    </span> ·{" "}
                    {String(r.result || "")}
                  </div>
                  <button type="button" className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`} onClick={() => setExpandedAct(open ? null : id)}>
                    {open ? "Collapse" : "Expand"}
                  </button>
                  {open ? (
                    <pre style={{ fontSize: "0.72rem", background: "#f5f5f5", padding: "0.5rem", borderRadius: 8, overflow: "auto" }}>
                      {JSON.stringify(row, null, 2)}
                    </pre>
                  ) : null}
                  {!r.humanFeedback ? (
                    <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.35rem" }}>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                        onClick={async () => {
                          await fetch(apiUrl(`/agents/activity/${id}/feedback`), {
                            method: "PUT",
                            headers: { "Content-Type": "application/json", ...authHeaders() },
                            body: JSON.stringify({ feedback: "good" }),
                          });
                          void loadActivity();
                        }}
                      >
                        Good
                      </button>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                        onClick={async () => {
                          await fetch(apiUrl(`/agents/activity/${id}/feedback`), {
                            method: "PUT",
                            headers: { "Content-Type": "application/json", ...authHeaders() },
                            body: JSON.stringify({ feedback: "needs_improvement", notes: "" }),
                          });
                          void loadActivity();
                        }}
                      >
                        Needs improvement
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGhost}`}
                disabled={actOffset === 0}
                onClick={() => setActOffset((o) => Math.max(0, o - 20))}
              >
                Previous
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGhost}`}
                disabled={actOffset + 20 >= activity.total}
                onClick={() => setActOffset((o) => o + 20)}
              >
                Next
              </button>
              <span style={{ fontSize: "0.82rem", alignSelf: "center" }}>
                {activity.total ? `${actOffset + 1}–${Math.min(activity.total, actOffset + 20)} of ${activity.total}` : ""}
              </span>
            </div>
          </section>
        ) : null}

        {tab === "queue" ? (
          <section className={styles.panel}>
            <h3>Queued for review</h3>
            {queue.length === 0 ? <p>No pending items.</p> : null}
            {queue.map((raw) => {
              const q = raw as Record<string, unknown>;
              const id = q.id as number;
              return (
                <div key={id} className={styles.queueCard}>
                  <div style={{ fontSize: "0.78rem" }}>#{id}</div>
                  {q.aiDraft ? <pre className={styles.queueDraft}>{String(q.aiDraft)}</pre> : null}
                  {isAdmin ? (
                    <div className={styles.actionsRow}>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`}
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          await fetch(apiUrl(`/agents/queue/${id}/approve`), { method: "PUT", headers: { ...authHeaders() } });
                          setBusy(false);
                          void loadSecondary();
                        }}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                        onClick={() => setEditQ({ id, text: String(q.aiDraft || "") })}
                      >
                        Edit &amp; send
                      </button>
                      <button type="button" className={`${styles.btn} ${styles.btnDanger} ${styles.btnSm}`} onClick={() => setRejectQ({ id, notes: "" })}>
                        Reject
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </section>
        ) : null}

        {tab === "performance" ? (
          <section className={styles.panel}>
            <h3>Performance</h3>
            <AgentPerformancePanel metrics={metrics30.length ? metrics30 : metrics} />
          </section>
        ) : null}
      </main>

      {activateOpen ? (
        <div className={styles.modalOverlay} role="dialog" aria-modal>
          <div className={styles.modal}>
            <h2>Activate agent</h2>
            <p style={{ fontSize: "0.9rem" }}>
              Activating <strong>{agent.name}</strong> will allow automated actions. Start in Testing mode first?
            </p>
            <div className={styles.modalActions}>
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setActivateOpen(false)}>
                Cancel
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => void setStatus("active")}>
                Activate anyway
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => void setStatus("testing")}>
                Use Testing mode
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {testOpen ? (
        <div className={styles.modalOverlay} role="dialog" aria-modal>
          <div className={styles.modal}>
            <h2>Test prompt</h2>
            <textarea className={styles.promptArea} value={testInput} onChange={(e) => setTestInput(e.target.value)} placeholder="Sample trigger…" />
            {testOut ? <pre className={styles.queueDraft}>{testOut}</pre> : null}
            <div className={styles.modalActions}>
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setTestOpen(false)}>
                Close
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy} onClick={() => void runTestPrompt()}>
                Run test
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editQ ? (
        <div className={styles.modalOverlay} role="dialog" aria-modal>
          <div className={styles.modal}>
            <h2>Edit draft</h2>
            <textarea className={styles.promptArea} value={editQ.text} onChange={(e) => setEditQ({ ...editQ, text: e.target.value })} />
            <div className={styles.modalActions}>
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setEditQ(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await fetch(apiUrl(`/agents/queue/${editQ.id}/edit`), {
                    method: "PUT",
                    headers: { "Content-Type": "application/json", ...authHeaders() },
                    body: JSON.stringify({ editedDraft: editQ.text }),
                  });
                  setEditQ(null);
                  setBusy(false);
                  void loadSecondary();
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {rejectQ ? (
        <div className={styles.modalOverlay} role="dialog" aria-modal>
          <div className={styles.modal}>
            <h2>Reject</h2>
            <textarea value={rejectQ.notes} onChange={(e) => setRejectQ({ ...rejectQ, notes: e.target.value })} />
            <div className={styles.modalActions}>
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setRejectQ(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnDanger}`}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await fetch(apiUrl(`/agents/queue/${rejectQ.id}/reject`), {
                    method: "PUT",
                    headers: { "Content-Type": "application/json", ...authHeaders() },
                    body: JSON.stringify({ notes: rejectQ.notes }),
                  });
                  setRejectQ(null);
                  setBusy(false);
                  void loadSecondary();
                }}
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function GuardList({
  items,
  setItems,
  disabled,
}: {
  items: string[];
  setItems: (v: string[]) => void;
  disabled: boolean;
}) {
  return (
    <div className={styles.guardList}>
      {items.map((line, i) => (
        <div key={i} className={styles.guardItem}>
          <input
            value={line}
            disabled={disabled}
            onChange={(e) => {
              const n = [...items];
              n[i] = e.target.value;
              setItems(n);
            }}
          />
          {!disabled ? (
            <button type="button" className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`} onClick={() => setItems(items.filter((_, j) => j !== i))}>
              ✕
            </button>
          ) : null}
        </div>
      ))}
      {!disabled ? (
        <button type="button" className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`} onClick={() => setItems([...items, ""])}>
          + Add
        </button>
      ) : null}
    </div>
  );
}
