"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import styles from "../operations.module.css";
import OperationsTopBar from "../OperationsTopBar";
import { apiUrl } from "../../../../lib/api";
import { useAuth } from "../../../../context/AuthContext";
import type {
  AnalyticsBottlenecks,
  AnalyticsKpis,
  AnalyticsTrends,
  AnalyticsTypeRow,
  AnalyticsWorkload,
  Template,
  TeamUser,
} from "../types";

const NAVY = "#1B2856";
const BLUE = "#0098D0";
const RED = "#B32317";
const GREEN = "#10b981";
const AMBER = "#f59e0b";

type Range = "month" | "30d" | "90d" | "quarter" | "year" | "custom";

function rangeBounds(r: Range, custom: { from: string; to: string }) {
  const today = new Date();
  const yyyy = (d: Date) => d.toISOString().slice(0, 10);
  const from = (() => {
    switch (r) {
      case "month": {
        const d = new Date(today.getFullYear(), today.getMonth(), 1);
        return yyyy(d);
      }
      case "30d": {
        const d = new Date(today);
        d.setDate(d.getDate() - 30);
        return yyyy(d);
      }
      case "90d": {
        const d = new Date(today);
        d.setDate(d.getDate() - 90);
        return yyyy(d);
      }
      case "quarter": {
        const q = Math.floor(today.getMonth() / 3);
        return yyyy(new Date(today.getFullYear(), q * 3, 1));
      }
      case "year":
        return yyyy(new Date(today.getFullYear(), 0, 1));
      case "custom":
        return custom.from || yyyy(new Date(today.getFullYear(), 0, 1));
    }
  })();
  const to = r === "custom" ? custom.to || yyyy(today) : yyyy(today);
  return { from, to };
}

function fmtNum(n: number | null | undefined, suffix = ""): string {
  if (n === null || n === undefined) return "—";
  return `${Math.round(n * 10) / 10}${suffix}`;
}

function trendArrow(t: AnalyticsKpis["completionTrend"]): string {
  return t === "up" ? "↑" : t === "down" ? "↓" : "→";
}

function pctColor(p: number | null): string {
  if (p == null) return "#6a737b";
  if (p >= 80) return GREEN;
  if (p >= 60) return AMBER;
  return RED;
}

function capacityTone(cap: string): { bg: string; fg: string; bar: string; label: string } {
  if (cap === "over") return { bg: "#FFEBEE", fg: "#B32317", bar: RED, label: "Over capacity" };
  if (cap === "high") return { bg: "#FFF8E1", fg: "#E5890A", bar: AMBER, label: "High load" };
  if (cap === "normal") return { bg: "#E8F5E9", fg: "#1B8A4E", bar: GREEN, label: "Normal" };
  return { bg: "#F5F5F5", fg: "#6A737B", bar: "#6a737b", label: "Available" };
}

export default function AnalyticsClient() {
  const { authHeaders, token } = useAuth();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [range, setRange] = useState<Range>("90d");
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: "", to: "" });

  const [kpis, setKpis] = useState<AnalyticsKpis | null>(null);
  const [bottlenecks, setBottlenecks] = useState<AnalyticsBottlenecks | null>(null);
  const [workload, setWorkload] = useState<AnalyticsWorkload | null>(null);
  const [trends, setTrends] = useState<AnalyticsTrends | null>(null);
  const [byType, setByType] = useState<AnalyticsTypeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const filters = useMemo(() => {
    const { from, to } = rangeBounds(range, custom);
    const params = new URLSearchParams();
    params.set("from", from);
    params.set("to", to);
    if (templateId) params.set("templateId", templateId);
    if (userId) params.set("userId", userId);
    return params.toString();
  }, [range, custom, templateId, userId]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const headers = { ...authHeaders() };
      const get = async <T,>(path: string): Promise<T | null> => {
        const res = await fetch(apiUrl(`${path}?${filters}`), { headers, cache: "no-store" });
        if (!res.ok) return null;
        return (await res.json()) as T;
      };
      const [k, b, w, t, byT] = await Promise.all([
        get<AnalyticsKpis>("/process-analytics/kpis"),
        get<AnalyticsBottlenecks>("/process-analytics/bottlenecks"),
        get<AnalyticsWorkload>("/process-analytics/workload"),
        get<AnalyticsTrends>("/process-analytics/trends"),
        get<{ types: AnalyticsTypeRow[] }>("/process-analytics/by-type"),
      ]);
      setKpis(k);
      setBottlenecks(b);
      setWorkload(w);
      setTrends(t);
      setByType(byT?.types || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load analytics.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, filters]);

  useEffect(() => {
    load();
  }, [load]);

  // Load filter dropdowns once.
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const [tplRes, usersRes] = await Promise.all([
          fetch(apiUrl("/processes/templates"), {
            headers: { ...authHeaders() },
            cache: "no-store",
          }),
          fetch(apiUrl("/users"), {
            headers: { ...authHeaders() },
            cache: "no-store",
          }),
        ]);
        if (tplRes.ok) {
          const body = await tplRes.json();
          setTemplates(body.templates || []);
        }
        if (usersRes.ok) {
          const body = await usersRes.json();
          setUsers(body.users || []);
        }
      } catch {
        /* ignore */
      }
    })();
  }, [authHeaders, token]);

  // Bottleneck bars sorted by avgDays desc.
  const sortedBottlenecks = useMemo(() => {
    if (!bottlenecks?.stages) return [];
    return [...bottlenecks.stages]
      .filter((s) => s.totalPasses > 0)
      .sort((a, b) => (b.avgDays ?? 0) - (a.avgDays ?? 0));
  }, [bottlenecks]);

  return (
    <div className={styles.page}>
      <OperationsTopBar />
      <div className={styles.main}>
        <h2 style={{ color: NAVY, margin: "0 0 0.75rem" }}>Process Analytics</h2>

        {/* Filter bar */}
        <div
          className={styles.toolbar}
          style={{ flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}
        >
          <select
            className={styles.select}
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            <option value="">All process types</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.icon} {t.name}
              </option>
            ))}
          </select>
          <select
            className={styles.select}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          >
            <option value="">All team</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </select>
          <div className={styles.viewToggle}>
            {(
              [
                ["month", "This Month"],
                ["30d", "Last 30d"],
                ["90d", "Last 90d"],
                ["quarter", "This Quarter"],
                ["year", "This Year"],
              ] as Array<[Range, string]>
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={`${styles.viewToggleBtn} ${range === k ? styles.viewToggleActive : ""}`}
                onClick={() => setRange(k)}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className={`${styles.viewToggleBtn} ${range === "custom" ? styles.viewToggleActive : ""}`}
              onClick={() => setRange("custom")}
            >
              Custom
            </button>
          </div>
          {range === "custom" ? (
            <>
              <input
                type="date"
                className={styles.searchInput}
                value={custom.from}
                onChange={(e) => setCustom({ ...custom, from: e.target.value })}
                style={{ maxWidth: 160 }}
              />
              <input
                type="date"
                className={styles.searchInput}
                value={custom.to}
                onChange={(e) => setCustom({ ...custom, to: e.target.value })}
                style={{ maxWidth: 160 }}
              />
            </>
          ) : null}
        </div>

        {err ? <div className={styles.errorBanner}>{err}</div> : null}
        {loading && !kpis ? <div className={styles.loading}>Loading analytics…</div> : null}

        {/* Section 1: KPI cards */}
        {kpis ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "0.75rem",
              marginBottom: "1.5rem",
            }}
          >
            <KpiCard
              label="Active Processes"
              value={String(kpis.activeProcesses)}
              accent={BLUE}
              icon="🔄"
            />
            <KpiCard
              label="Overdue"
              value={String(kpis.overdueProcesses)}
              accent={kpis.overdueProcesses > 0 ? RED : GREEN}
              icon="⚠"
            />
            <KpiCard
              label="Completed This Month"
              value={String(kpis.completedThisMonth)}
              accent={GREEN}
              icon="✓"
              footer={
                kpis.completedLastMonth > 0
                  ? `${trendArrow(kpis.completionTrend)} vs ${kpis.completedLastMonth} last month`
                  : "No prior comparison"
              }
              footerTone={
                kpis.completionTrend === "up"
                  ? GREEN
                  : kpis.completionTrend === "down"
                  ? RED
                  : "#6a737b"
              }
            />
            <KpiCard
              label="Avg Completion"
              value={kpis.avgCompletionDays != null ? `${kpis.avgCompletionDays}d` : "—"}
              accent={"#8b5cf6"}
              icon="⏱"
              footer={
                kpis.avgCompletionDaysLastMonth != null
                  ? `${
                      kpis.avgCompletionDays != null &&
                      kpis.avgCompletionDays < kpis.avgCompletionDaysLastMonth
                        ? "↓"
                        : "↑"
                    } ${kpis.avgCompletionDaysLastMonth}d last month`
                  : null
              }
              footerTone={
                kpis.avgCompletionDays != null &&
                kpis.avgCompletionDaysLastMonth != null &&
                kpis.avgCompletionDays < kpis.avgCompletionDaysLastMonth
                  ? GREEN
                  : RED
              }
            />
            <KpiCard
              label="On-Time Rate"
              value={kpis.onTimeRate != null ? `${kpis.onTimeRate}%` : "—"}
              accent={pctColor(kpis.onTimeRate)}
              icon="📊"
              footer={
                kpis.autopilotCreated > 0
                  ? `${kpis.autopilotCreated} auto-created in window`
                  : null
              }
            />
          </div>
        ) : null}

        {/* Section 2: bottlenecks + workload */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)",
            gap: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          <div className={styles.sidebarCard}>
            <h3>Stage Bottlenecks{templateId ? "" : " (pick a process type)"}</h3>
            {!templateId ? (
              <p style={{ color: "#6a737b", fontSize: "0.85rem" }}>
                Select a process type above to see per-stage averages and identify
                where processes get stuck.
              </p>
            ) : sortedBottlenecks.length === 0 ? (
              <p style={{ color: "#6a737b", fontSize: "0.85rem" }}>
                Not enough stage history yet. Data will accumulate as processes
                move between stages.
              </p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={Math.max(220, sortedBottlenecks.length * 38)}>
                  <BarChart
                    layout="vertical"
                    data={sortedBottlenecks}
                    margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
                    <XAxis type="number" stroke={NAVY} tick={{ fontSize: 11 }} />
                    <YAxis
                      type="category"
                      dataKey="stageName"
                      stroke={NAVY}
                      width={140}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip
                      formatter={(v: number) => [`${v} days`, "Avg"]}
                      labelStyle={{ color: NAVY }}
                    />
                    <Bar dataKey="avgDays" radius={[0, 4, 4, 0]}>
                      {sortedBottlenecks.map((s, i) => (
                        <Cell
                          key={s.stageId}
                          fill={s.isBottleneck ? RED : s.stageColor || BLUE}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                {bottlenecks?.worstBottleneck ? (
                  <div
                    style={{
                      marginTop: "0.5rem",
                      padding: "0.6rem 0.75rem",
                      background: "rgba(179, 35, 23, 0.06)",
                      border: `1px solid rgba(179, 35, 23, 0.25)`,
                      borderRadius: 8,
                      color: NAVY,
                      fontSize: "0.82rem",
                    }}
                  >
                    <strong style={{ color: RED }}>⚠ Bottleneck:</strong>{" "}
                    {bottlenecks.worstBottleneck.suggestion}
                  </div>
                ) : null}
              </>
            )}
          </div>

          <div className={styles.sidebarCard}>
            <h3>Team Workload</h3>
            {workload?.suggestion ? (
              <div
                style={{
                  marginBottom: "0.75rem",
                  padding: "0.6rem 0.75rem",
                  background: "rgba(139, 92, 246, 0.08)",
                  border: "1px solid rgba(139, 92, 246, 0.3)",
                  borderRadius: 8,
                  color: NAVY,
                  fontSize: "0.82rem",
                }}
              >
                {workload.suggestion}
              </div>
            ) : null}
            {!workload?.team?.length ? (
              <p style={{ color: "#6a737b", fontSize: "0.85rem" }}>
                No team members with active assignments yet.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {workload.team.map((m) => {
                  const tone = capacityTone(m.capacity);
                  return (
                    <div
                      key={m.userId}
                      style={{
                        padding: "0.55rem 0.7rem",
                        border: "1px solid rgba(27, 40, 86, 0.08)",
                        borderRadius: 8,
                        background: "rgba(27, 40, 86, 0.02)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: "0.5rem",
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div
                            style={{ fontWeight: 700, color: NAVY, fontSize: "0.92rem" }}
                          >
                            {m.userName}
                            {m.userRole ? (
                              <span
                                style={{
                                  marginLeft: "0.4rem",
                                  fontSize: "0.7rem",
                                  color: "#6a737b",
                                  fontWeight: 500,
                                }}
                              >
                                {m.userRole}
                              </span>
                            ) : null}
                          </div>
                          <div style={{ fontSize: "0.78rem", color: "#6a737b" }}>
                            {m.activeTasks} active · {m.overdueTasks} overdue ·{" "}
                            {m.completedThisWeek} done this week
                          </div>
                        </div>
                        <span
                          style={{
                            fontSize: "0.7rem",
                            fontWeight: 700,
                            padding: "0.15rem 0.55rem",
                            borderRadius: 999,
                            background: tone.bg,
                            color: tone.fg,
                          }}
                        >
                          {tone.label}
                        </span>
                      </div>
                      <div
                        style={{
                          marginTop: "0.4rem",
                          height: 6,
                          background: "rgba(27, 40, 86, 0.06)",
                          borderRadius: 999,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${Math.min(100, m.capacityScore)}%`,
                            height: "100%",
                            background: tone.bar,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Section 3: completion trends */}
        {trends && trends.months.length > 0 ? (
          <div className={styles.sidebarCard} style={{ marginBottom: "1.5rem" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h3 style={{ margin: 0 }}>Completion Trends (last 6 months)</h3>
              {trends.months.length >= 2 && trends.improvementPct !== 0 ? (
                <span
                  style={{
                    fontSize: "0.78rem",
                    fontWeight: 700,
                    padding: "0.2rem 0.55rem",
                    borderRadius: 999,
                    background: trends.improving
                      ? "rgba(16, 185, 129, 0.12)"
                      : "rgba(179, 35, 23, 0.1)",
                    color: trends.improving ? GREEN : RED,
                  }}
                >
                  {trends.improving ? "↓" : "↑"} {Math.abs(trends.improvementPct)}%{" "}
                  {trends.improving ? "faster" : "slower"}
                </span>
              ) : null}
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={trends.months} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" stroke={NAVY} tick={{ fontSize: 11 }} />
                <YAxis
                  yAxisId="left"
                  stroke={BLUE}
                  tick={{ fontSize: 11 }}
                  label={{
                    value: "Completed",
                    angle: -90,
                    position: "insideLeft",
                    fill: BLUE,
                    fontSize: 11,
                  }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke={AMBER}
                  tick={{ fontSize: 11 }}
                  label={{
                    value: "Avg days",
                    angle: 90,
                    position: "insideRight",
                    fill: AMBER,
                    fontSize: 11,
                  }}
                />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar
                  yAxisId="left"
                  dataKey="completed"
                  name="Completed"
                  fill={BLUE}
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="avgDays"
                  name="Avg days"
                  stroke={AMBER}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : null}

        {/* Section 4: by type table */}
        {byType.length > 0 ? (
          <div className={styles.sidebarCard}>
            <h3>Performance by Process Type</h3>
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.85rem",
                }}
              >
                <thead>
                  <tr style={{ textAlign: "left", color: "#6a737b" }}>
                    <th style={{ padding: "0.4rem 0.5rem" }}>Process Type</th>
                    <th style={{ padding: "0.4rem 0.5rem", textAlign: "right" }}>Active</th>
                    <th style={{ padding: "0.4rem 0.5rem", textAlign: "right" }}>Completed</th>
                    <th style={{ padding: "0.4rem 0.5rem", textAlign: "right" }}>Avg Days</th>
                    <th style={{ padding: "0.4rem 0.5rem", textAlign: "right" }}>On Time</th>
                    <th style={{ padding: "0.4rem 0.5rem" }}>Bottleneck</th>
                  </tr>
                </thead>
                <tbody>
                  {byType.map((row) => (
                    <tr
                      key={row.templateId}
                      onClick={() => setTemplateId(String(row.templateId))}
                      style={{
                        cursor: "pointer",
                        borderTop: "1px solid rgba(27, 40, 86, 0.06)",
                      }}
                    >
                      <td style={{ padding: "0.5rem", color: NAVY, fontWeight: 600 }}>
                        {row.icon ? `${row.icon} ` : ""}
                        {row.templateName}
                      </td>
                      <td style={{ padding: "0.5rem", textAlign: "right" }}>
                        {row.activeCount}
                      </td>
                      <td style={{ padding: "0.5rem", textAlign: "right" }}>
                        {row.completedCount}
                      </td>
                      <td style={{ padding: "0.5rem", textAlign: "right" }}>
                        {fmtNum(row.avgCompletionDays, "d")}
                      </td>
                      <td
                        style={{
                          padding: "0.5rem",
                          textAlign: "right",
                          color: pctColor(row.onTimeRate),
                          fontWeight: 700,
                        }}
                      >
                        {row.onTimeRate != null ? `${row.onTimeRate}%` : "—"}
                      </td>
                      <td style={{ padding: "0.5rem", color: "#6a737b" }}>
                        {row.bottleneckStage
                          ? `${row.bottleneckStage} (${row.bottleneckAvgDays ?? "—"}d)`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  accent,
  icon,
  footer,
  footerTone,
}: {
  label: string;
  value: string;
  accent: string;
  icon?: string;
  footer?: string | null;
  footerTone?: string;
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid rgba(27, 40, 86, 0.08)",
        borderTop: `3px solid ${accent}`,
        borderRadius: 8,
        padding: "0.75rem 0.9rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.2rem",
      }}
    >
      <div
        style={{
          fontSize: "0.68rem",
          color: "#6a737b",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {icon ? `${icon} ` : ""}
        {label}
      </div>
      <div style={{ fontSize: "1.7rem", fontWeight: 800, color: "#1B2856" }}>{value}</div>
      {footer ? (
        <div style={{ fontSize: "0.72rem", color: footerTone || "#6a737b" }}>{footer}</div>
      ) : null}
    </div>
  );
}
