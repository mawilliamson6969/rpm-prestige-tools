"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useAuth } from "../../../../context/AuthContext";
import { apiUrl } from "../../../../lib/api";
import AiIdeasModal from "./AiIdeasModal";
import ContentEditorModal, { type Campaign, type Channel, type ContentItem, type TeamUser } from "./ContentEditorModal";
import styles from "./marketing-calendar.module.css";

function toYmd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function mondayOf(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function firstOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function lastOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function buildMonthCells(year: number, month: number) {
  const first = new Date(year, month, 1);
  const startPad = first.getDay();
  const cells: { date: Date; inMonth: boolean }[] = [];
  const start = new Date(year, month, 1 - startPad);
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push({ date: d, inMonth: d.getMonth() === month });
  }
  return cells;
}

function dotClass(st: string) {
  if (st === "idea") return styles.dotIdea;
  if (st === "draft") return styles.dotDraft;
  if (st === "review") return styles.dotReview;
  if (st === "scheduled") return styles.dotScheduled;
  if (st === "published") return styles.dotPublished;
  return styles.dotArchived;
}

function badgeStyle(st: string): CSSProperties {
  const map: Record<string, string> = {
    idea: "#6a737b",
    draft: "#0098d0",
    review: "#c5960c",
    scheduled: "#2d8b4e",
    published: "#0d4d2e",
    archived: "#9aa0a6",
  };
  return {
    background: `${map[st] ?? "#6a737b"}22`,
    color: map[st] ?? "#6a737b",
    border: `1px solid ${map[st] ?? "#6a737b"}44`,
  };
}

function campaignBarStyle(
  startDate: string | null,
  endDate: string | null,
  monthStart: Date,
  monthEnd: Date,
  color: string
): CSSProperties {
  const msStart = monthStart.getTime();
  const msEnd = monthEnd.getTime() + 86400000;
  const span = msEnd - msStart;
  const A = startDate ? new Date(startDate + "T12:00:00") : monthStart;
  const B = endDate ? new Date(endDate + "T12:00:00") : monthEnd;
  const clampA = Math.max(msStart, A.getTime());
  const clampB = Math.min(msEnd - 1, B.getTime() + 43200000);
  if (clampB < clampA) return { display: "none" };
  const left = ((clampA - msStart) / span) * 100;
  const width = Math.max(((clampB - clampA) / span) * 100, 2);
  return {
    left: `${left}%`,
    width: `${width}%`,
    background: color || "#0098d0",
  };
}

type MainView = "calendar" | "list" | "board" | "campaigns";
type CalSub = "month" | "week" | "day";

type Stats = {
  publishedThisMonth: number;
  scheduledUpcoming: number;
  draftCount: number;
  overdueCount: number;
};

export default function MarketingCalendarClient() {
  const { authHeaders } = useAuth();
  const [anchor, setAnchor] = useState(() => new Date());
  const [mainView, setMainView] = useState<MainView>("calendar");
  const [calSub, setCalSub] = useState<CalSub>("month");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [teamUsers, setTeamUsers] = useState<TeamUser[]>([]);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterCampaignId, setFilterCampaignId] = useState<number | "">("");
  const [filterAssigned, setFilterAssigned] = useState<number | "">("");
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
  const [filterChannelIds, setFilterChannelIds] = useState<number[]>([]);
  const [sortKey, setSortKey] = useState<"title" | "channel" | "status" | "scheduledDate" | "assignedToName" | "contentType">(
    "scheduledDate"
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [defaultDate, setDefaultDate] = useState<string | null>(null);
  const [ideasOpen, setIdeasOpen] = useState(false);
  const [campModal, setCampModal] = useState<{ id: number | null } | null>(null);
  const [campForm, setCampForm] = useState({ name: "", description: "", startDate: "", endDate: "", color: "#0098d0", status: "planning" });

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const range = useMemo(() => {
    if (mainView === "calendar" && calSub === "month") {
      const a = firstOfMonth(anchor);
      const b = lastOfMonth(anchor);
      return { start: toYmd(a), end: toYmd(b) };
    }
    if (mainView === "calendar" && calSub === "week") {
      const m = mondayOf(anchor);
      const sun = addDays(m, 6);
      return { start: toYmd(m), end: toYmd(sun) };
    }
    if (mainView === "calendar" && calSub === "day") {
      const d = toYmd(anchor);
      return { start: d, end: d };
    }
    const s = firstOfMonth(anchor);
    s.setMonth(s.getMonth() - 2);
    const e = lastOfMonth(anchor);
    e.setMonth(e.getMonth() + 4);
    return { start: toYmd(s), end: toYmd(e) };
  }, [anchor, mainView, calSub]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      q.set("startDate", range.start);
      q.set("endDate", range.end);
      if (mainView === "list" || mainView === "board" || mainView === "campaigns") q.set("includeUndated", "1");
      if (filterCampaignId !== "") q.set("campaignId", String(filterCampaignId));
      if (filterAssigned !== "") q.set("assignedTo", String(filterAssigned));
      if (debouncedSearch) q.set("search", debouncedSearch);
      if (filterChannelIds.length) q.set("channelIds", filterChannelIds.join(","));

      const [chRes, campRes, teamRes, coRes, stRes] = await Promise.all([
        fetch(apiUrl("/marketing/channels"), { headers: { ...authHeaders() } }),
        fetch(apiUrl("/marketing/campaigns"), { headers: { ...authHeaders() } }),
        fetch(apiUrl("/eos/team-users"), { headers: { ...authHeaders() } }),
        fetch(apiUrl(`/marketing/content?${q}`), { headers: { ...authHeaders() } }),
        fetch(apiUrl("/marketing/stats"), { headers: { ...authHeaders() } }),
      ]);
      const [chB, campB, teamB, coB, stB] = await Promise.all([
        chRes.json().catch(() => ({})),
        campRes.json().catch(() => ({})),
        teamRes.json().catch(() => ({})),
        coRes.json().catch(() => ({})),
        stRes.json().catch(() => ({})),
      ]);
      if (chRes.ok && Array.isArray(chB.channels)) setChannels(chB.channels);
      if (campRes.ok && Array.isArray(campB.campaigns)) setCampaigns(campB.campaigns);
      if (teamRes.ok && Array.isArray(teamB.users))
        setTeamUsers(teamB.users.map((u: { id: number; displayName: string; username: string }) => u));
      if (coRes.ok && Array.isArray(coB.content)) setContent(coB.content);
      if (stRes.ok) setStats(stB);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, range.start, range.end, mainView, filterCampaignId, filterAssigned, debouncedSearch, filterChannelIds]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const filtered = useMemo(() => {
    let rows = [...content];
    if (filterStatuses.length) {
      rows = rows.filter((c) => filterStatuses.includes(c.status));
    }
    return rows;
  }, [content, filterStatuses]);

  const byDay = useMemo(() => {
    const m = new Map<string, ContentItem[]>();
    for (const c of filtered) {
      if (!c.scheduledDate) continue;
      const arr = m.get(c.scheduledDate) ?? [];
      arr.push(c);
      m.set(c.scheduledDate, arr);
    }
    return m;
  }, [filtered]);

  const navLabel = useMemo(() => {
    if (mainView !== "calendar") return "";
    if (calSub === "month") {
      return anchor.toLocaleString("en-US", { month: "long", year: "numeric" });
    }
    if (calSub === "week") {
      const m = mondayOf(anchor);
      const e = addDays(m, 6);
      return `${m.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${e.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
    }
    return anchor.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }, [anchor, mainView, calSub]);

  const prevNext = (dir: -1 | 1) => {
    const x = new Date(anchor);
    if (mainView === "calendar" && calSub === "month") x.setMonth(x.getMonth() + dir);
    else if (mainView === "calendar" && calSub === "week") x.setDate(x.getDate() + dir * 7);
    else if (mainView === "calendar" && calSub === "day") x.setDate(x.getDate() + dir);
    else x.setMonth(x.getMonth() + dir);
    setAnchor(x);
  };

  const goToday = () => setAnchor(new Date());

  const openNew = (dateStr?: string) => {
    setEditId(null);
    setDefaultDate(dateStr ?? toYmd(anchor));
    setModalOpen(true);
  };

  const openEdit = (id: number) => {
    setEditId(id);
    setDefaultDate(null);
    setModalOpen(true);
  };

  const onDropReschedule = async (id: number, ymd: string) => {
    try {
      const res = await fetch(apiUrl(`/marketing/content/${id}`), {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledDate: ymd }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || "Could not reschedule");
      }
      loadAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not reschedule");
    }
  };

  const onDropStatus = async (id: number, status: string) => {
    try {
      const res = await fetch(apiUrl(`/marketing/content/${id}/status`), {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || "Could not update");
      }
      loadAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not update");
    }
  };

  const toggleChannelFilter = (id: number) => {
    setFilterChannelIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  const sortedList = useMemo(() => {
    const rows = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      let va: string | number | null | undefined;
      let vb: string | number | null | undefined;
      if (sortKey === "channel") {
        va = a.channel?.name ?? "";
        vb = b.channel?.name ?? "";
      } else {
        va = (a as Record<string, unknown>)[sortKey] as string | number | null | undefined;
        vb = (b as Record<string, unknown>)[sortKey] as string | number | null | undefined;
      }
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), undefined, { sensitivity: "base" }) * dir;
    });
    return rows;
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (k: "title" | "channel" | "status" | "scheduledDate" | "assignedToName" | "contentType") => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  };

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const bulkStatus = async (st: string) => {
    for (const id of Array.from(selected)) {
      await onDropStatus(id, st);
    }
    setSelected(new Set());
  };

  const monthCells = useMemo(() => buildMonthCells(anchor.getFullYear(), anchor.getMonth()), [anchor]);
  const monthStart = firstOfMonth(anchor);
  const monthEnd = lastOfMonth(anchor);

  const boardCols = ["idea", "draft", "review", "scheduled", "published", "archived"] as const;

  const saveCampaign = async () => {
    if (!campForm.name.trim()) {
      alert("Name required");
      return;
    }
    const id = campModal?.id;
    const url = id ? apiUrl(`/marketing/campaigns/${id}`) : apiUrl("/marketing/campaigns");
    const res = await fetch(url, {
      method: id ? "PUT" : "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        name: campForm.name.trim(),
        description: campForm.description || null,
        startDate: campForm.startDate || null,
        endDate: campForm.endDate || null,
        color: campForm.color,
        status: campForm.status,
      }),
    });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(b.error || "Save failed");
      return;
    }
    setCampModal(null);
    loadAll();
  };

  const deleteCampaign = async (id: number) => {
    if (!confirm("Delete this campaign? Linked content will be unlinked from this campaign.")) return;
    const res = await fetch(apiUrl(`/marketing/campaigns/${id}`), { method: "DELETE", headers: { ...authHeaders() } });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      alert(b.error || "Delete failed");
      return;
    }
    loadAll();
  };

  const weekDays = useMemo(() => {
    const m = mondayOf(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(m, i));
  }, [anchor]);

  return (
    <div className={styles.page}>
      <div className={styles.topRow}>
        <div>
          <h1 className={styles.title}>Marketing Calendar</h1>
          <p className={styles.sub}>
            Plan and schedule content across all channels.{" "}
            <Link href="/" style={{ color: "#0098d0", fontWeight: 600 }}>
              ← Team Hub
            </Link>
          </p>
        </div>
      </div>

      {stats ? (
        <div className={styles.statsBar}>
          <div className={styles.stat}>
            <strong>{stats.publishedThisMonth}</strong> Published this month
          </div>
          <div className={styles.stat}>
            <strong>{stats.scheduledUpcoming}</strong> Scheduled upcoming
          </div>
          <div className={styles.stat}>
            <strong>{stats.draftCount}</strong> In draft
          </div>
          <div className={`${styles.stat} ${stats.overdueCount > 0 ? styles.statWarn : ""}`}>
            <strong>{stats.overdueCount}</strong> Overdue
          </div>
        </div>
      ) : null}

      <div className={styles.toolbar}>
        <div className={styles.toggleGroup}>
          {(["calendar", "list", "board", "campaigns"] as MainView[]).map((v) => (
            <button key={v} type="button" className={mainView === v ? styles.active : ""} onClick={() => setMainView(v)}>
              {v === "calendar" ? "Calendar" : v === "list" ? "List" : v === "board" ? "Board" : "Campaigns"}
            </button>
          ))}
        </div>
        {mainView === "calendar" ? (
          <div className={styles.toggleGroup}>
            {(["month", "week", "day"] as CalSub[]).map((v) => (
              <button key={v} type="button" className={calSub === v ? styles.active : ""} onClick={() => setCalSub(v)}>
                {v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        ) : null}
        {mainView === "calendar" ? (
          <div className={styles.navMonth}>
            <button type="button" onClick={() => prevNext(-1)}>
              &lt; Previous
            </button>
            <span className={styles.navLabel}>{navLabel}</span>
            <button type="button" onClick={() => prevNext(1)}>
              Next &gt;
            </button>
            <button type="button" onClick={goToday}>
              Today
            </button>
          </div>
        ) : null}
        <button type="button" className={styles.btnPrimary} onClick={() => openNew()}>
          + New Content
        </button>
        <button type="button" className={styles.btnAi} onClick={() => setIdeasOpen(true)}>
          AI Ideas ✨
        </button>
      </div>

      <div className={styles.filters}>
        <div className={styles.filterField}>
          <label>Channels</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", maxWidth: 420 }}>
            {channels
              .filter((c) => c.isActive !== false)
              .map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleChannelFilter(c.id)}
                  style={{
                    fontSize: "0.75rem",
                    padding: "0.2rem 0.45rem",
                    borderRadius: 999,
                    border: filterChannelIds.includes(c.id) ? `2px solid ${c.color}` : "1px solid rgba(27,40,86,0.15)",
                    background: filterChannelIds.includes(c.id) ? `${c.color}22` : "#fff",
                    cursor: "pointer",
                  }}
                >
                  {c.icon} {c.name}
                </button>
              ))}
          </div>
        </div>
        <div className={styles.filterField}>
          <label>Status</label>
          <select
            multiple
            value={filterStatuses}
            onChange={(e) => setFilterStatuses(Array.from(e.target.selectedOptions).map((o) => o.value))}
            style={{ minHeight: "5rem" }}
          >
            {["idea", "draft", "review", "scheduled", "published", "archived"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.filterField}>
          <label>Assigned</label>
          <select value={filterAssigned === "" ? "" : String(filterAssigned)} onChange={(e) => setFilterAssigned(e.target.value ? Number(e.target.value) : "")}>
            <option value="">All</option>
            {teamUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.filterField}>
          <label>Campaign</label>
          <select value={filterCampaignId === "" ? "" : String(filterCampaignId)} onChange={(e) => setFilterCampaignId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">All</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.filterField}>
          <label>Search</label>
          <input type="search" placeholder="Title, body…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {loading ? <p className={styles.emptyHint}>Loading calendar…</p> : null}

      {!loading && mainView === "calendar" && calSub === "month" ? (
        <>
          <div className={`${styles.calWrap} ${styles.calDesktop}`}>
            <div className={styles.campaignStripWrap}>
              {campaigns.map((c) => (
                <div
                  key={c.id}
                  className={styles.campaignBar}
                  style={campaignBarStyle(c.startDate ?? null, c.endDate ?? null, monthStart, monthEnd, c.color || "#0098d0")}
                  title={c.name}
                >
                  {c.name}
                </div>
              ))}
            </div>
            <div className={styles.weekdayRow}>
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className={styles.weekdayCell}>
                  {d}
                </div>
              ))}
            </div>
            <div className={styles.grid}>
              {monthCells.map(({ date, inMonth }) => {
                const ymd = toYmd(date);
                const isToday = ymd === toYmd(new Date());
                const items = byDay.get(ymd) ?? [];
                return (
                  <div
                    key={ymd}
                    className={`${styles.dayCell} ${isToday ? styles.today : ""} ${!inMonth ? styles.outMonth : ""}`}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      try {
                        const raw = e.dataTransfer.getData("application/json");
                        if (!raw) return;
                        const { id } = JSON.parse(raw) as { id: number };
                        if (id) void onDropReschedule(id, ymd);
                      } catch {
                        /* ignore */
                      }
                    }}
                    onClick={(ev) => {
                      if ((ev.target as HTMLElement).closest("[data-pill]")) return;
                      openNew(ymd);
                    }}
                  >
                    <div className={styles.dayNum}>{date.getDate()}</div>
                    {items.map((it) => (
                      <div
                        key={it.id}
                        data-pill
                        className={styles.pill}
                        style={{ background: it.channel?.color || "#0098d0" }}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("application/json", JSON.stringify({ id: it.id }));
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(it.id);
                        }}
                        title={it.title}
                      >
                        <span className={`${styles.statusDot} ${dotClass(it.status)}`} />
                        <span aria-hidden>{it.channel?.icon ?? "📢"}</span>
                        <span className={styles.pillTitle}>{it.title}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          <div className={styles.mobileList}>
            {monthCells
              .filter(({ inMonth }) => inMonth)
              .map(({ date }) => {
                const ymd = toYmd(date);
                const items = byDay.get(ymd) ?? [];
                return (
                  <div key={ymd} className={styles.dayCell} style={{ marginBottom: "0.5rem" }}>
                    <div className={styles.dayNum}>
                      {date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                    </div>
                    {items.length === 0 ? <div className={styles.emptyHint}>No items</div> : null}
                    {items.map((it) => (
                      <div
                        key={it.id}
                        className={styles.pill}
                        style={{ background: it.channel?.color || "#0098d0" }}
                        onClick={() => openEdit(it.id)}
                      >
                        <span className={`${styles.statusDot} ${dotClass(it.status)}`} />
                        <span className={styles.pillTitle}>{it.title}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
          </div>
        </>
      ) : null}

      {!loading && mainView === "calendar" && calSub === "week" ? (
        <div className={styles.calWrap}>
          <div className={styles.grid} style={{ gridTemplateColumns: "repeat(7,1fr)" }}>
            {weekDays.map((d) => {
              const ymd = toYmd(d);
              const items = byDay.get(ymd) ?? [];
              return (
                <div key={ymd} className={styles.dayCell} onDragOver={(e) => e.preventDefault()} onDrop={(e) => {
                  e.preventDefault();
                  try {
                    const raw = e.dataTransfer.getData("application/json");
                    if (!raw) return;
                    const { id } = JSON.parse(raw) as { id: number };
                    if (id) void onDropReschedule(id, ymd);
                  } catch {
                    /* ignore */
                  }
                }}>
                  <div className={styles.dayNum}>{d.toLocaleDateString("en-US", { weekday: "short", day: "numeric" })}</div>
                  {items.map((it) => (
                    <div
                      key={it.id}
                      className={styles.pill}
                      style={{ background: it.channel?.color || "#0098d0" }}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("application/json", JSON.stringify({ id: it.id }));
                      }}
                      onClick={() => openEdit(it.id)}
                    >
                      <span className={`${styles.statusDot} ${dotClass(it.status)}`} />
                      <span className={styles.pillTitle}>{it.title}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {!loading && mainView === "calendar" && calSub === "day" ? (
        <div className={styles.calWrap}>
          <div className={styles.dayCell} style={{ minHeight: "12rem" }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => {
            e.preventDefault();
            try {
              const raw = e.dataTransfer.getData("application/json");
              if (!raw) return;
              const { id } = JSON.parse(raw) as { id: number };
              if (id) void onDropReschedule(id, toYmd(anchor));
            } catch {
              /* ignore */
            }
          }}>
            <div className={styles.dayNum}>{anchor.toLocaleDateString("en-US", { dateStyle: "full" })}</div>
            {(byDay.get(toYmd(anchor)) ?? []).map((it) => (
              <div key={it.id} className={styles.pill} style={{ background: it.channel?.color || "#0098d0" }} draggable onDragStart={(e) => e.dataTransfer.setData("application/json", JSON.stringify({ id: it.id }))} onClick={() => openEdit(it.id)}>
                <span className={`${styles.statusDot} ${dotClass(it.status)}`} />
                <span className={styles.pillTitle}>{it.title}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!loading && mainView === "list" ? (
        <div className={styles.tableWrap}>
          <div style={{ padding: "0.5rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: "0.82rem", color: "#6a737b" }}>{selected.size} selected</span>
            <select onChange={(e) => { const v = e.target.value; if (v) void bulkStatus(v); e.target.value = ""; }} style={{ maxWidth: 160 }}>
              <option value="">Bulk set status…</option>
              {["idea", "draft", "review", "scheduled", "published", "archived"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>
                  <input type="checkbox" aria-label="Select all" onChange={(e) => {
                    if (e.target.checked) setSelected(new Set(sortedList.map((r) => r.id)));
                    else setSelected(new Set());
                  }} />
                </th>
                <th onClick={() => toggleSort("title")}>Title</th>
                <th onClick={() => toggleSort("channel")}>Channel</th>
                <th onClick={() => toggleSort("status")}>Status</th>
                <th onClick={() => toggleSort("scheduledDate")}>Scheduled</th>
                <th onClick={() => toggleSort("assignedToName")}>Assigned</th>
                <th>Campaign</th>
                <th onClick={() => toggleSort("contentType")}>Type</th>
              </tr>
            </thead>
            <tbody>
              {sortedList.map((it) => (
                <tr key={it.id}>
                  <td>
                    <input type="checkbox" checked={selected.has(it.id)} onChange={() => toggleSelect(it.id)} />
                  </td>
                  <td>
                    <button type="button" className={styles.btnGhost} style={{ border: "none", padding: 0, textAlign: "left" }} onClick={() => openEdit(it.id)}>
                      {it.title}
                    </button>
                  </td>
                  <td>
                    {it.channel?.icon} {it.channel?.name ?? "—"}
                  </td>
                  <td>
                    <span className={styles.badge} style={badgeStyle(it.status)}>
                      {it.status}
                    </span>
                  </td>
                  <td>{it.scheduledDate ?? "—"}</td>
                  <td>{it.assignedToName ?? "—"}</td>
                  <td>{(it.campaigns || []).map((c) => c.name).join(", ") || "—"}</td>
                  <td>{it.contentType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {!loading && mainView === "board" ? (
        <div className={styles.board}>
          {boardCols.map((col) => (
            <div
              key={col}
              className={styles.boardCol}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                try {
                  const raw = e.dataTransfer.getData("application/json");
                  if (!raw) return;
                  const { id } = JSON.parse(raw) as { id: number };
                  if (id) void onDropStatus(id, col);
                } catch {
                  /* ignore */
                }
              }}
            >
              <div className={styles.boardColHead}>{col}</div>
              {filtered
                .filter((c) => c.status === col)
                .map((it) => (
                  <div
                    key={it.id}
                    className={styles.boardCard}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("application/json", JSON.stringify({ id: it.id }))}
                    onClick={() => openEdit(it.id)}
                  >
                    <strong style={{ fontSize: "0.88rem" }}>{it.title}</strong>
                    <div className={styles.cardMeta}>
                      <span>
                        {it.channel?.icon} {it.channel?.name ?? "Channel"}
                      </span>
                    </div>
                    <div className={styles.cardMeta}>{it.scheduledDate ?? "No date"}</div>
                    <div className={styles.cardMeta}>{it.assignedToName ?? "Unassigned"}</div>
                  </div>
                ))}
            </div>
          ))}
        </div>
      ) : null}

      {!loading && mainView === "campaigns" ? (
        <div className={styles.campaignList}>
          <button type="button" className={styles.btnPrimary} onClick={() => {
            setCampForm({ name: "", description: "", startDate: "", endDate: "", color: "#0098d0", status: "planning" });
            setCampModal({ id: null });
          }}>
            + New campaign
          </button>
          {campaigns.map((c) => (
            <div key={c.id} className={styles.campaignRow}>
              <div>
                <strong style={{ color: c.color || "#1b2856" }}>{c.name}</strong>
                <div style={{ fontSize: "0.8rem", color: "#6a737b" }}>
                  {c.startDate ?? "?"} → {c.endDate ?? "?"} · {c.contentCount ?? 0} items · {c.status ?? "planning"}
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.35rem" }}>
                <button
                  type="button"
                  className={styles.btnGhost}
                  onClick={() => {
                    setCampModal({ id: c.id });
                    setCampForm({
                      name: c.name,
                      description: (c as { description?: string }).description ?? "",
                      startDate: (c as { startDate?: string }).startDate ?? "",
                      endDate: (c as { endDate?: string }).endDate ?? "",
                      color: (c as { color?: string }).color ?? "#0098d0",
                      status: (c as { status?: string }).status ?? "planning",
                    });
                  }}
                >
                  Edit
                </button>
                <button type="button" className={`${styles.btnGhost} ${styles.btnDanger}`} onClick={() => deleteCampaign(c.id)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <ContentEditorModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        contentId={editId}
        defaultDate={defaultDate}
        channels={channels}
        campaigns={campaigns}
        teamUsers={teamUsers}
        authHeaders={authHeaders}
        onSaved={() => loadAll()}
      />

      <AiIdeasModal open={ideasOpen} onClose={() => setIdeasOpen(false)} channels={channels} authHeaders={authHeaders} onAdded={() => loadAll()} />

      {campModal ? (
        <div className={styles.modalOverlay} role="dialog" aria-modal onMouseDown={(e) => e.target === e.currentTarget && setCampModal(null)}>
          <div className={styles.modal}>
            <div className={styles.modalHead}>
              <h2>{campModal.id ? "Edit campaign" : "New campaign"}</h2>
              <button type="button" className={styles.btnGhost} onClick={() => setCampModal(null)}>
                Close
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.field}>
                <label>Name *</label>
                <input value={campForm.name} onChange={(e) => setCampForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div className={styles.field}>
                <label>Description</label>
                <textarea rows={2} value={campForm.description} onChange={(e) => setCampForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
              <div className={styles.field}>
                <label>Start date</label>
                <input type="date" value={campForm.startDate} onChange={(e) => setCampForm((f) => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div className={styles.field}>
                <label>End date</label>
                <input type="date" value={campForm.endDate} onChange={(e) => setCampForm((f) => ({ ...f, endDate: e.target.value }))} />
              </div>
              <div className={styles.field}>
                <label>Color</label>
                <input type="color" value={campForm.color} onChange={(e) => setCampForm((f) => ({ ...f, color: e.target.value }))} />
              </div>
              <div className={styles.field}>
                <label>Status</label>
                <select value={campForm.status} onChange={(e) => setCampForm((f) => ({ ...f, status: e.target.value }))}>
                  {["planning", "active", "completed", "paused"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className={styles.modalFoot}>
              <button type="button" className={styles.btnGhost} onClick={() => setCampModal(null)}>
                Cancel
              </button>
              <button type="button" className={styles.btnPrimary} onClick={() => void saveCampaign()}>
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
