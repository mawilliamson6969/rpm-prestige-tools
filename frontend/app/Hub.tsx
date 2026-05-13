"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  FileText,
  Mail,
  Plus,
  RefreshCw,
  Settings,
  type LucideIcon,
} from "lucide-react";
import styles from "./hub.module.css";
import { useAuth } from "../context/AuthContext";
import { apiUrl } from "../lib/api";
import useTeam, { type TeamMember } from "../hooks/useTeam";

/* ============================================================
   Tiny pure SVG sparkline.
   Mirrors home.jsx Sparkline.
   ============================================================ */

function Sparkline({
  data,
  color = "var(--rpm-navy)",
  height = 28,
  width = 220,
}: {
  data: number[];
  color?: string;
  height?: number;
  width?: number;
}) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = data[data.length - 1];
  const lastY = height - ((last - min) / range) * (height - 4) - 2;
  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ display: "block" }}
      aria-hidden
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts}
      />
      <circle cx={width} cy={lastY} r={2.5} fill={color} />
    </svg>
  );
}

/* ============================================================
   KPI card
   ============================================================ */

type DeltaDir = "up" | "down" | "flat";

function KPI({
  label,
  value,
  valueClass = "",
  delta,
  deltaDir = "up",
  sparkData,
  sparkColor,
  foot,
}: {
  label: string;
  value: string | null | undefined;
  valueClass?: string;
  delta?: string | null;
  deltaDir?: DeltaDir;
  sparkData?: number[];
  sparkColor?: string;
  foot?: string;
}) {
  const showValue = value !== null && value !== undefined && value !== "";
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={`${styles.kpiValue} ${valueClass}`}>
        {showValue ? value : <span className={styles.kpiPlaceholder}>—</span>}
      </div>
      {(delta || foot) && (
        <div className={styles.kpiFoot}>
          {delta ? (
            <span
              className={`${styles.kpiDelta} ${
                deltaDir === "up"
                  ? styles.kpiDeltaUp
                  : deltaDir === "down"
                  ? styles.kpiDeltaDown
                  : styles.kpiDeltaFlat
              }`}
            >
              {deltaDir === "up" ? (
                <ArrowUp size={10} strokeWidth={2.5} />
              ) : deltaDir === "down" ? (
                <ArrowDown size={10} strokeWidth={2.5} />
              ) : (
                <ArrowRight size={10} strokeWidth={2.5} />
              )}
              {delta}
            </span>
          ) : null}
          {foot ? <span>{foot}</span> : null}
        </div>
      )}
      {sparkData && sparkData.length >= 2 ? (
        <div className={styles.kpiSpark}>
          <Sparkline data={sparkData} color={sparkColor} />
        </div>
      ) : null}
    </div>
  );
}

/* ============================================================
   Tools grid — static config of launchers (per design intent).
   Brand-color square chip with monogram.
   ============================================================ */

type ToolDef = {
  id: string;
  name: string;
  desc: string;
  mono: string;
  color: string;
  href: string;
  external?: boolean;
  live?: boolean;
};

const TOOLS: ToolDef[] = [
  { id: "appfolio",   name: "AppFolio",     desc: "Property management OS",  mono: "AF", color: "#1B2856", href: "https://rpmtx033.appfolio.com",            external: true, live: true },
  { id: "leadsimple", name: "LeadSimple",   desc: "CRM & lead workflows",     mono: "LS", color: "#0098D0", href: "https://app.leadsimple.com",               external: true, live: true },
  { id: "rentengine", name: "RentEngine",   desc: "Leasing automation",       mono: "RE", color: "#7A5AE0", href: "https://app.rentengine.io/owner/default", external: true, live: true },
  { id: "blanket",    name: "Blanket",      desc: "Owner retention",          mono: "BL", color: "#1F8A5B", href: "https://rpmprestige.blankethomes.com/pm",  external: true },
  { id: "boom",       name: "Boom",         desc: "Rent payments + screening", mono: "BM", color: "#B32317", href: "https://www.boompay.app/",                 external: true },
  { id: "openphone",  name: "OpenPhone",    desc: "Team telephony",            mono: "OP", color: "#7A5AE0", href: "https://app.openphone.com",                external: true },
];

/* ============================================================
   Useful links — moved into static config (matches design).
   ============================================================ */

const USEFUL_LINKS = [
  { label: "Texas Property Code Ch. 92", href: "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.92.htm" },
  { label: "TREC Website",               href: "https://www.trec.texas.gov" },
  { label: "HAR MLS",                    href: "https://www.har.com" },
  { label: "RPM Prestige Website",       href: "https://www.prestigerpm.com/" },
  { label: "RPM Intranet",               href: "https://rpmintranet.com/login" },
];

/* ============================================================
   Types for live data
   ============================================================ */

type OccupancyData = {
  totalUnitCount: number;
  occupancyRatePercent: number;
  vacantCount: number;
  onNoticeUnits?: number;
  refreshedAt?: string;
};

type AnnouncementRow = {
  id: string;
  title: string;
  content: string;
  created_at: string;
  status?: string;
};

type CrossBoardTask = {
  kind: string;
  id: number;
  title: string;
  status: string;
  priority: string;
  taskType: string;
  dueDate: string | null;
  templateName: string | null;
};

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner / Operator",
  admin: "Administrator",
  csm: "Client Success Manager",
  maintenance: "Maintenance Coordinator",
  operations: "Operations",
  staff: "Team Member",
};

const DIRECTORY_PALETTE = ["#0098D0", "#B32317", "#1B2856", "#1F8A5B", "#7A5AE0", "#C77800"];

function directoryColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return DIRECTORY_PALETTE[Math.abs(hash) % DIRECTORY_PALETTE.length];
}

function directoryInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase() || "?";
}

function priorityToPill(p: string): { label: string; className: string } {
  const lower = p.toLowerCase();
  if (lower === "asap" || lower === "urgent")
    return { label: "Urgent", className: styles.pillUrgent };
  if (lower === "high")
    return { label: "High", className: styles.pillWarn };
  if (lower === "low")
    return { label: "Low", className: styles.pillNeutral };
  return { label: "Normal", className: styles.pillInfo };
}

function dueLabel(due: string | null): string {
  if (!due) return "—";
  try {
    const d = new Date(due);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    d.setHours(0, 0, 0, 0);
    if (d.getTime() === today.getTime()) return "Today";
    if (d.getTime() === tomorrow.getTime()) return "Tomorrow";
    if (d < today) return "Overdue";
    return d.toLocaleDateString(undefined, { weekday: "short" });
  } catch {
    return "—";
  }
}

function timeAgo(iso: string): string {
  try {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function plural(n: number, sing: string, pl: string) {
  return `${n} ${n === 1 ? sing : pl}`;
}

/* ============================================================
   Sparkline mock generators.
   TODO: wire to time-series KPI history once the dashboard cache
   exposes a /dashboard/history endpoint. For now we synthesize a
   short trend that ends at the real current value so the visual
   matches but the value is honest.                            */

function trendDownTo(value: number, step: number, len = 7): number[] {
  const out: number[] = [];
  for (let i = 0; i < len; i++) out.push(Math.max(0, value + (len - 1 - i) * step));
  return out;
}

function trendUpTo(value: number, step: number, len = 7): number[] {
  const out: number[] = [];
  for (let i = 0; i < len; i++) out.push(Math.max(0, value - (len - 1 - i) * step));
  return out;
}

/* ============================================================
   Activity item placeholder.
   TODO: replace with a real /activity feed once one exists.
   The interface below is what that endpoint should return.     */

type ActivityRow = {
  id: string;
  icon: LucideIcon;
  color: string;
  title: string;
  meta: string;
  timeIso: string;
};

/* ============================================================
   Hub component
   ============================================================ */

export default function Hub() {
  const { authHeaders, token, user } = useAuth();
  const { team } = useTeam();

  const [occupancy, setOccupancy] = useState<OccupancyData | null>(null);
  const [occLoading, setOccLoading] = useState(true);
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([]);
  const [tasks, setTasks] = useState<CrossBoardTask[]>([]);

  const loadOccupancy = useCallback(async () => {
    if (!token) return;
    setOccLoading(true);
    try {
      const res = await fetch(apiUrl("/dashboard/occupancy"), {
        cache: "no-store",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setOccupancy(body as OccupancyData);
      else setOccupancy(null);
    } catch {
      setOccupancy(null);
    } finally {
      setOccLoading(false);
    }
  }, [authHeaders, token]);

  const loadAnnouncements = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl("/announcements"), {
        cache: "no-store",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(body.announcements)) {
        setAnnouncements(body.announcements);
      }
    } catch {
      setAnnouncements([]);
    }
  }, [authHeaders, token]);

  const loadTasks = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl("/tasks/my-all"), {
        cache: "no-store",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(body.tasks)) setTasks(body.tasks);
    } catch {
      setTasks([]);
    }
  }, [authHeaders, token]);

  useEffect(() => {
    loadOccupancy();
    loadAnnouncements();
    loadTasks();
  }, [loadOccupancy, loadAnnouncements, loadTasks]);

  const completeTask = async (t: CrossBoardTask) => {
    try {
      const res = await fetch(apiUrl(`/processes/steps/${t.id}/complete`), {
        method: "PUT",
        headers: { ...authHeaders() },
      });
      if (res.ok) await loadTasks();
    } catch {
      /* surface in MyTasks page; keep Hub forgiving */
    }
  };

  /* ---------- Greeting ---------- */

  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const firstName =
    user?.displayName?.trim().split(/\s+/)[0] || user?.username || "there";

  /* ---------- Open task counts ---------- */

  const openTasks = useMemo(
    () => tasks.filter((t) => t.status !== "completed"),
    [tasks]
  );

  const todayTasks = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return openTasks
      .filter((t) => {
        if (!t.dueDate) return false;
        const d = new Date(t.dueDate);
        d.setHours(0, 0, 0, 0);
        return d <= today;
      })
      .slice(0, 5);
  }, [openTasks]);

  const tasksToShow = todayTasks.length > 0 ? todayTasks : openTasks.slice(0, 5);

  /* ---------- KPI subtitle ---------- */

  const subtitle = useMemo(() => {
    const parts: string[] = [];
    if (occupancy) {
      parts.push(plural(occupancy.totalUnitCount, "door", "doors"));
      parts.push(`${occupancy.occupancyRatePercent.toFixed(1)}% occupancy`);
    }
    parts.push(plural(openTasks.length, "open task", "open tasks"));
    return parts.join(" · ");
  }, [occupancy, openTasks.length]);

  /* ---------- KPI sparkline data (mocked trend → real value) ---------- */

  const doorsSpark = occupancy ? trendUpTo(occupancy.totalUnitCount, 2) : undefined;
  const occupancySpark = occupancy
    ? trendUpTo(occupancy.occupancyRatePercent, 0.4).map((n) =>
        Math.min(100, Math.max(0, n))
      )
    : undefined;
  const vacancySpark = occupancy ? trendDownTo(occupancy.vacantCount, -1) : undefined;
  const onNoticeSpark =
    occupancy && typeof occupancy.onNoticeUnits === "number"
      ? trendDownTo(occupancy.onNoticeUnits, -0.5)
      : undefined;

  /* ---------- Activity (placeholder feed) ---------- */

  const activity: ActivityRow[] = useMemo(
    () => [
      ...(announcements.slice(0, 1).map((a) => ({
        id: `ann-${a.id}`,
        icon: Mail,
        color: "var(--rpm-blue)",
        title: a.title,
        meta: "New announcement posted",
        timeIso: a.created_at,
      })) ?? []),
      ...(occupancy?.refreshedAt
        ? [
            {
              id: "sync",
              icon: RefreshCw,
              color: "var(--ink-600)",
              title: "AppFolio data refreshed",
              meta: `${occupancy.totalUnitCount} doors · ${occupancy.vacantCount} vacant`,
              timeIso: occupancy.refreshedAt,
            },
          ]
        : []),
      ...(openTasks.slice(0, 2).map((t) => ({
        id: `task-${t.id}`,
        icon: t.status === "blocked" ? AlertCircle : CheckCircle2,
        color: t.priority === "asap" ? "var(--rpm-red)" : "var(--success)",
        title: t.title,
        meta: t.templateName || "Standalone task",
        timeIso: t.dueDate || new Date().toISOString(),
      })) ?? []),
    ],
    [announcements, occupancy, openTasks]
  );

  return (
    <div className={`${styles.page} ${styles.fadeIn}`}>
      {/* Greeting */}
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <div className={styles.eyebrow}>{dateStr}</div>
          <h1 className={styles.h1}>
            {greeting}, {firstName}
          </h1>
          <div className={styles.subtitle}>{subtitle}</div>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnSecondary}`}
            onClick={() => {
              loadOccupancy();
              loadAnnouncements();
              loadTasks();
            }}
            disabled={occLoading}
          >
            <RefreshCw size={13} strokeWidth={2.2} /> Resync
          </button>
          <Link
            href="/announcements"
            className={`${styles.btn} ${styles.btnPrimary}`}
          >
            <Plus size={13} strokeWidth={2.2} /> Announcement
          </Link>
        </div>
      </div>

      {/* KPI strip */}
      <div className={styles.kpiGrid}>
        <KPI
          label="Total Doors"
          value={occupancy ? String(occupancy.totalUnitCount) : null}
          foot="active units"
          sparkData={doorsSpark}
          sparkColor="var(--rpm-navy)"
        />
        <KPI
          label="Occupancy"
          value={occupancy ? `${occupancy.occupancyRatePercent.toFixed(1)}%` : null}
          foot={
            occupancy
              ? plural(occupancy.totalUnitCount - occupancy.vacantCount, "occupied", "occupied")
              : ""
          }
          sparkData={occupancySpark}
          sparkColor="var(--success)"
        />
        <KPI
          label="Vacant Units"
          value={occupancy ? String(occupancy.vacantCount) : null}
          valueClass={
            occupancy && occupancy.vacantCount > 20 ? styles.kpiValueNegative : ""
          }
          foot={occupancy ? "goal: <20" : ""}
          sparkData={vacancySpark}
          sparkColor="var(--rpm-red)"
        />
        <KPI
          label="On Notice"
          value={
            occupancy && typeof occupancy.onNoticeUnits === "number"
              ? String(occupancy.onNoticeUnits)
              : null
          }
          foot="upcoming move-outs"
          sparkData={onNoticeSpark}
          sparkColor="var(--rpm-blue)"
        />
      </div>

      {/* Main two-col layout */}
      <div className={styles.col2_1}>
        {/* LEFT */}
        <div className={styles.stack20}>
          {/* Your day */}
          <section className={styles.card}>
            <div className={styles.sectionTitleRow}>
              <div className={styles.sectionTitle}>Your day</div>
              <Link href="/operations/my-tasks" className={styles.sectionAction}>
                All tasks <ArrowRight size={11} strokeWidth={2.2} />
              </Link>
            </div>
            {tasksToShow.length === 0 ? (
              <div className={styles.empty}>
                You&rsquo;re clear. Nothing due today.
              </div>
            ) : (
              <div>
                {tasksToShow.map((t) => {
                  const isDone = t.status === "completed";
                  const pill = priorityToPill(t.priority);
                  return (
                    <div key={`${t.kind}-${t.id}`} className={styles.taskRow}>
                      <button
                        type="button"
                        className={`${styles.taskCheck} ${isDone ? styles.taskCheckDone : ""}`}
                        onClick={() => completeTask(t)}
                        aria-label={isDone ? "Mark incomplete" : "Mark complete"}
                      >
                        {isDone ? <CheckCircle2 size={12} strokeWidth={2.5} /> : null}
                      </button>
                      <div className={`${styles.taskText} ${isDone ? styles.taskTextDone : ""}`}>
                        {t.title}
                      </div>
                      <span className={`${styles.pill} ${pill.className}`}>{pill.label}</span>
                      <div className={styles.taskMeta}>{dueLabel(t.dueDate)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Tools */}
          <section className={styles.card}>
            <div className={styles.sectionTitleRow}>
              <div className={styles.sectionTitle}>Your tools</div>
              <span className={styles.sectionAction}>
                Customize <Settings size={11} strokeWidth={2.2} />
              </span>
            </div>
            <div className={styles.toolGrid}>
              {TOOLS.map((tool) => (
                <a
                  key={tool.id}
                  href={tool.href}
                  target={tool.external ? "_blank" : undefined}
                  rel={tool.external ? "noopener noreferrer" : undefined}
                  className={styles.toolCard}
                >
                  <div className={styles.toolIcon} style={{ background: tool.color }}>
                    {tool.mono}
                  </div>
                  <div className={styles.toolMeta}>
                    <div className={styles.toolName}>
                      {tool.name}
                      {tool.live ? <span className={styles.liveTag}>Live</span> : null}
                    </div>
                    <div className={styles.toolDesc}>{tool.desc}</div>
                  </div>
                  {tool.external ? (
                    <span className={styles.toolExt} aria-hidden>
                      <ArrowUpRight size={13} strokeWidth={2.2} />
                    </span>
                  ) : null}
                </a>
              ))}
            </div>
          </section>

          {/* Recent activity */}
          <section className={styles.card}>
            <div className={styles.sectionTitleRow}>
              <div className={styles.sectionTitle}>Recent activity</div>
              <Link href="/inbox" className={styles.sectionAction}>
                View all <ArrowRight size={11} strokeWidth={2.2} />
              </Link>
            </div>
            {activity.length === 0 ? (
              <div className={styles.empty}>No recent activity yet.</div>
            ) : (
              <div className={styles.list}>
                {activity.map((a) => {
                  const Icon = a.icon;
                  return (
                    <div key={a.id} className={styles.listItem}>
                      <div
                        className={styles.activityChip}
                        style={{ color: a.color }}
                      >
                        <Icon size={14} strokeWidth={2} />
                      </div>
                      <div className={styles.listMeta}>
                        <div className={styles.listT1}>{a.title}</div>
                        <div className={styles.listT2}>{a.meta}</div>
                      </div>
                      <div className={styles.taskMeta}>{timeAgo(a.timeIso)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* RIGHT */}
        <div className={styles.stack20}>
          {/* Announcements */}
          <section className={styles.card}>
            <div className={styles.sectionTitleRow}>
              <div className={styles.sectionTitle}>Announcements</div>
              <Link
                href="/announcements"
                className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
              >
                <Plus size={11} strokeWidth={2.2} /> New
              </Link>
            </div>
            {announcements.length === 0 ? (
              <div className={styles.empty}>No announcements yet.</div>
            ) : (
              <div className={styles.stack12}>
                {announcements.slice(0, 3).map((a) => (
                  <div key={a.id} className={styles.announcement}>
                    <div className={styles.announcementHeader}>
                      <span className={`${styles.pill} ${styles.pillInfo}`}>
                        Announcement
                      </span>
                      <span className={styles.announcementTime}>
                        {timeAgo(a.created_at)}
                      </span>
                    </div>
                    <div className={styles.announcementTitle}>{a.title}</div>
                    <div className={styles.announcementBody}>{a.content}</div>
                  </div>
                ))}
                {announcements.length > 3 ? (
                  <Link href="/announcements" className={styles.sectionAction}>
                    See all {announcements.length} announcements{" "}
                    <ArrowRight size={11} strokeWidth={2.2} />
                  </Link>
                ) : null}
              </div>
            )}
          </section>

          {/* Team */}
          <section className={styles.card}>
            <div className={styles.sectionTitleRow}>
              <div className={styles.sectionTitle}>Team</div>
              <Link href="/admin/users" className={styles.sectionAction}>
                Directory <ArrowRight size={11} strokeWidth={2.2} />
              </Link>
            </div>
            {team.length === 0 ? (
              <div className={styles.empty}>No teammates loaded.</div>
            ) : (
              <div className={styles.list}>
                {team.slice(0, 5).map((m: TeamMember) => (
                  <div key={m.id} className={styles.listItem}>
                    <div className={styles.teamAvatarWrap}>
                      <div
                        className={styles.avatar}
                        style={{ background: directoryColor(m.username || m.displayName) }}
                      >
                        {directoryInitials(m.displayName || m.username)}
                      </div>
                      {/* TODO: real online/away status when presence service exists. */}
                      <span className={styles.teamStatusDot} />
                    </div>
                    <div className={styles.listMeta}>
                      <div className={styles.listT1}>
                        {m.displayName || m.username}
                      </div>
                      <div className={styles.listT2}>
                        {ROLE_LABELS[m.role] || m.role}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Useful links */}
          <section className={styles.card}>
            <div className={styles.sectionTitleRow}>
              <div className={styles.sectionTitle}>Useful links</div>
            </div>
            <div className={styles.list}>
              {USEFUL_LINKS.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.listItem}
                >
                  <ExternalLink size={13} strokeWidth={2} color="var(--text-muted)" />
                  <div className={styles.listMeta}>
                    <div className={styles.listT1} style={{ fontWeight: 500 }}>
                      {l.label}
                    </div>
                  </div>
                  <ArrowUpRight size={11} strokeWidth={2.2} color="var(--text-muted)" />
                </a>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
