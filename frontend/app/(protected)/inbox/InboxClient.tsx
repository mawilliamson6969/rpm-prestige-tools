"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import { apiUrl } from "../../../lib/api";
import styles from "./inbox.module.css";

type TicketRow = {
  id: number;
  subject: string | null;
  body_preview: string | null;
  sender_name: string | null;
  sender_email: string | null;
  recipient_emails: string | null;
  priority: number;
  category: string;
  status: string;
  is_read: boolean;
  is_starred: boolean;
  received_at: string | null;
  ai_summary: string | null;
  linked_property_name: string | null;
  linked_tenant_name: string | null;
  linked_owner_name: string | null;
  body_html: string | null;
  assigned_to?: number | null;
  assignee_username?: string | null;
  assignee_name?: string | null;
};

type ResponseRow = {
  id: number;
  response_type: string;
  body: string | null;
  body_html: string | null;
  sent_via: string | null;
  created_at: string;
  responded_by_name: string | null;
};

type Stats = {
  totalOpen: number;
  unread: number;
  assignedToMe: number;
  unassigned: number;
  starred: number;
  byCategory: Record<string, number>;
};

type TeamUser = { id: number; username: string; displayName: string };

const CATEGORY_ORDER = [
  "maintenance",
  "leasing",
  "accounting",
  "owner",
  "tenant",
  "vendor",
  "other",
] as const;

const CAT_STYLE: Record<string, { bg: string; color: string }> = {
  maintenance: { bg: "#fff3e0", color: "#e65100" },
  leasing: { bg: "#e3f2fd", color: "#1565c0" },
  accounting: { bg: "#e8f5e9", color: "#2e7d32" },
  owner: { bg: "#f3e5f5", color: "#6a1b9a" },
  tenant: { bg: "#e0f2f1", color: "#00695c" },
  vendor: { bg: "#eceff1", color: "#546e7a" },
  other: { bg: "#f5f5f5", color: "#757575" },
  legal: { bg: "#ffebee", color: "#c62828" },
  internal: { bg: "#e8eaf6", color: "#3949ab" },
  marketing: { bg: "#f1f8e9", color: "#558b2f" },
};

function priorityBarClass(p: number) {
  if (p >= 80) return "#b32317";
  if (p >= 50) return "#e65100";
  if (p >= 20) return "#f9a825";
  return "#9e9e9e";
}

function relativeTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function initials(name: string | null | undefined, email: string | null | undefined) {
  const s = (name || email || "?").trim();
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
  return s.slice(0, 2).toUpperCase();
}

function sanitizeEmailHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/\shref\s*=\s*["']\s*javascript:[^"']*["']/gi, "");
}

function escapeHtmlText(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Builds HTML for Graph API reply: message + optional `--` + signature HTML. */
function buildReplyEmailHtml(message: string, signatureHtml: string | null) {
  const t = message.trim();
  const main = escapeHtmlText(t).replace(/\r\n/g, "\n").split("\n").join("<br/>");
  const body = `<div style="font-family:Segoe UI,system-ui,sans-serif;font-size:11pt">${main}</div>`;
  const sig = signatureHtml?.trim();
  if (!sig) return body;
  return `${body}<p style="font-family:Segoe UI,system-ui,sans-serif;font-size:11pt">-- </p><div style="font-family:Segoe UI,system-ui,sans-serif;font-size:11pt">${sig}</div>`;
}

function priorityTier(p: number) {
  if (p >= 85) return 95;
  if (p >= 60) return 75;
  if (p >= 35) return 50;
  return 25;
}

export default function InboxClient() {
  const { authHeaders, isAdmin } = useAuth();

  const [stats, setStats] = useState<Stats | null>(null);
  const [teamUsers, setTeamUsers] = useState<TeamUser[]>([]);
  const [bucket, setBucket] = useState<string>("open");
  const [category, setCategory] = useState<string | null>(null);
  /** When set, uses bucket=all and this status (narrow view). When null, bucket controls pipeline. */
  const [narrowStatus, setNarrowStatus] = useState<string | null>(null);
  const [teamUserId, setTeamUserId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState("newest");

  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [syncBusy, setSyncBusy] = useState(false);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<TicketRow | null>(null);
  const [responses, setResponses] = useState<ResponseRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [composeMode, setComposeMode] = useState<"reply" | "note">("reply");
  const [composeBody, setComposeBody] = useState("");
  const [composeBusy, setComposeBusy] = useState(false);
  const [composeExpanded, setComposeExpanded] = useState(false);
  const [signatureHtml, setSignatureHtml] = useState<string | null>(null);
  /** Per-reply signature (editable); initialized from saved signature. */
  const [replySigDraft, setReplySigDraft] = useState("");

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const fn = () => setIsMobile(mq.matches);
    fn();
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  const limit = 40;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadStats = useCallback(async () => {
    const res = await fetch(apiUrl("/inbox/stats"), { cache: "no-store", headers: { ...authHeaders() } });
    const body = await res.json().catch(() => ({}));
    if (res.ok) setStats(body as Stats);
  }, [authHeaders]);

  useEffect(() => {
    loadStats();
    const id = setInterval(loadStats, 60_000);
    return () => clearInterval(id);
  }, [loadStats]);

  useEffect(() => {
    (async () => {
      const res = await fetch(apiUrl("/eos/team-users"), { headers: { ...authHeaders() } });
      const body = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(body.users)) {
        const want = new Set(["mike", "lori", "leslie", "amanda", "amelia"]);
        setTeamUsers(body.users.filter((u: TeamUser) => want.has(u.username.toLowerCase())));
      }
    })();
  }, [authHeaders]);

  useEffect(() => {
    (async () => {
      const res = await fetch(apiUrl("/users/me/signature"), {
        cache: "no-store",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && "signatureHtml" in body) {
        setSignatureHtml(typeof body.signatureHtml === "string" ? body.signatureHtml : null);
      }
    })();
  }, [authHeaders]);

  useEffect(() => {
    setComposeExpanded(false);
    setComposeBody("");
  }, [selectedId]);

  useEffect(() => {
    setReplySigDraft(signatureHtml ?? "");
  }, [signatureHtml, selectedId]);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (narrowStatus) {
      p.set("bucket", "all");
      p.set("status", narrowStatus);
    } else {
      p.set("bucket", bucket);
    }
    if (category) p.set("category", category);
    if (teamUserId != null) p.set("assignedTo", String(teamUserId));
    if (debouncedSearch.trim()) p.set("search", debouncedSearch.trim());
    if (sort === "oldest") p.set("sort", "oldest");
    else if (sort === "priority") p.set("sort", "priority");
    else if (sort === "updated") p.set("sort", "updated");
    else p.set("sort", "newest");
    p.set("limit", String(limit));
    return p.toString();
  }, [bucket, category, narrowStatus, teamUserId, debouncedSearch, sort]);

  const loadList = useCallback(
    async (startOffset: number, append: boolean) => {
      setListLoading(true);
      try {
        const p = new URLSearchParams(queryString);
        p.set("offset", String(startOffset));
        const res = await fetch(apiUrl(`/inbox/tickets?${p.toString()}`), {
          cache: "no-store",
          headers: { ...authHeaders() },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "List failed");
        const rows = body.tickets as TicketRow[];
        setTotal(body.total ?? 0);
        setOffset(startOffset + rows.length);
        setTickets((prev) => (append ? [...prev, ...rows] : rows));
      } catch {
        if (!append) setTickets([]);
      } finally {
        setListLoading(false);
      }
    },
    [authHeaders, queryString]
  );

  useEffect(() => {
    setOffset(0);
    loadList(0, false);
  }, [queryString, loadList]);

  const loadDetail = useCallback(
    async (id: number) => {
      setDetailLoading(true);
      try {
        const res = await fetch(apiUrl(`/inbox/tickets/${id}`), {
          cache: "no-store",
          headers: { ...authHeaders() },
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok) {
          setDetail(body.ticket as TicketRow);
          setResponses(Array.isArray(body.responses) ? body.responses : []);
        }
      } finally {
        setDetailLoading(false);
      }
    },
    [authHeaders]
  );

  useEffect(() => {
    if (selectedId == null) {
      setDetail(null);
      setResponses([]);
      return;
    }
    loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const openTicket = (id: number) => {
    setSelectedId(id);
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches) {
      setMobileDetail(true);
    }
    fetch(apiUrl(`/inbox/tickets/${id}`), {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ isRead: true }),
    }).then(() => {
      setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, is_read: true } : t)));
      loadStats();
    });
  };

  const closeMobileDetail = () => {
    setMobileDetail(false);
  };

  const updateTicket = async (patch: Record<string, unknown>) => {
    if (!selectedId) return;
    const res = await fetch(apiUrl(`/inbox/tickets/${selectedId}`), {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ticket) {
      setDetail(body.ticket);
      setTickets((prev) => prev.map((t) => (t.id === selectedId ? { ...t, ...body.ticket } : t)));
      loadStats();
    }
  };

  const toggleStar = async (e: React.MouseEvent, t: TicketRow) => {
    e.stopPropagation();
    const next = !t.is_starred;
    await fetch(apiUrl(`/inbox/tickets/${t.id}`), {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ isStarred: next }),
    });
    setTickets((prev) => prev.map((x) => (x.id === t.id ? { ...x, is_starred: next } : x)));
    if (detail?.id === t.id) setDetail({ ...detail, is_starred: next });
    loadStats();
  };

  const sendCompose = async () => {
    if (!selectedId || !composeBody.trim()) return;
    setComposeBusy(true);
    try {
      const path = composeMode === "reply" ? "reply" : "note";
      const payload =
        composeMode === "reply"
          ? { body: buildReplyEmailHtml(composeBody, replySigDraft.trim() ? replySigDraft : null) }
          : { body: composeBody.trim() };
      const res = await fetch(apiUrl(`/inbox/tickets/${selectedId}/${path}`), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setComposeBody("");
        setComposeExpanded(false);
        loadDetail(selectedId);
        loadList(0, false);
      }
    } finally {
      setComposeBusy(false);
    }
  };

  const onSync = async () => {
    setSyncBusy(true);
    try {
      await fetch(apiUrl("/inbox/sync/trigger"), { method: "POST", headers: { ...authHeaders() } });
      await loadStats();
      loadList(0, false);
    } finally {
      setSyncBusy(false);
    }
  };

  const layoutClass = [
    styles.layout,
    isMobile && mobileMenuOpen ? styles.sidebarOpen : "",
    mobileDetail ? styles.showDetailMobile : "",
  ]
    .filter(Boolean)
    .join(" ");

  const preset = (b: string) => {
    setBucket(b);
    setCategory(null);
    setNarrowStatus(null);
    setTeamUserId(null);
    setMobileMenuOpen(false);
  };

  const teamColors: Record<string, string> = {
    mike: "#0098d0",
    lori: "#b32317",
    leslie: "#1b2856",
    amanda: "#2e7d6b",
    amelia: "#6a1b9a",
  };

  const allActiveHighlight =
    narrowStatus === null &&
    bucket !== "starred" &&
    ["open", "unread", "assignedToMe", "unassigned"].includes(bucket);

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <div>
          <h1>Shared Inbox</h1>
          <div className={styles.topStats}>
            {stats ? (
              <>
                <span>
                  <strong>{stats.totalOpen}</strong> open
                </span>
                <span>
                  <strong>{stats.unread}</strong> unread
                </span>
                <span>
                  <strong>{stats.assignedToMe}</strong> assigned to you
                </span>
              </>
            ) : (
              <span>Loading stats…</span>
            )}
          </div>
        </div>
        <div className={styles.topActions}>
          {isAdmin ? (
            <button type="button" className={styles.iconBtn} title="Sync now" onClick={onSync} disabled={syncBusy}>
              ⟳
            </button>
          ) : null}
          <Link href="/inbox/settings" className={styles.mutedLink}>
            Settings
          </Link>
        </div>
      </header>

      {isMobile && mobileMenuOpen ? (
        <button
          type="button"
          className={styles.overlaySidebar}
          aria-label="Close menu"
          onClick={() => setMobileMenuOpen(false)}
        />
      ) : null}

      <div className={layoutClass}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <button type="button" className={styles.menuBtn} onClick={() => setMobileMenuOpen((o) => !o)}>
              ☰ Menu
            </button>
          </div>

          <button
            type="button"
            className={`${styles.presetBtn} ${bucket === "open" && !teamUserId && !category && !narrowStatus ? styles.active : ""}`}
            onClick={() => preset("open")}
          >
            All Open
            <span className={styles.badgeCount}>{stats?.totalOpen ?? "—"}</span>
          </button>
          <button
            type="button"
            className={`${styles.presetBtn} ${bucket === "unread" ? styles.active : ""}`}
            onClick={() => preset("unread")}
          >
            Unread
            <span className={styles.badgeCount}>{stats?.unread ?? "—"}</span>
          </button>
          <button
            type="button"
            className={`${styles.presetBtn} ${bucket === "starred" ? styles.active : ""}`}
            onClick={() => preset("starred")}
          >
            Starred
            <span className={styles.badgeCount}>{stats?.starred ?? "—"}</span>
          </button>
          <button
            type="button"
            className={`${styles.presetBtn} ${bucket === "assignedToMe" ? styles.active : ""}`}
            onClick={() => {
              preset("assignedToMe");
            }}
          >
            Assigned to Me
            <span className={styles.badgeCount}>{stats?.assignedToMe ?? "—"}</span>
          </button>
          <button
            type="button"
            className={`${styles.presetBtn} ${bucket === "unassigned" ? styles.active : ""}`}
            onClick={() => preset("unassigned")}
          >
            Unassigned
            <span className={styles.badgeCount}>{stats?.unassigned ?? "—"}</span>
          </button>

          <div className={styles.divider} />
          <div className={styles.catLabel}>Category</div>
          <div className={styles.pillGrid}>
            {CATEGORY_ORDER.map((c) => {
              const st = CAT_STYLE[c] || CAT_STYLE.other;
              return (
                <button
                  key={c}
                  type="button"
                  className={`${styles.pill} ${category === c ? styles.active : ""}`}
                  style={{ background: st.bg, color: st.color }}
                  onClick={() => {
                    setBucket("open");
                    setCategory(category === c ? null : c);
                    setNarrowStatus(null);
                    setTeamUserId(null);
                  }}
                >
                  {c}
                </button>
              );
            })}
          </div>

          <div className={styles.divider} />
          <div className={styles.catLabel}>Team</div>
          <div className={styles.teamRow}>
            {teamUsers.map((u) => (
              <button
                key={u.id}
                type="button"
                className={`${styles.teamAvatar} ${teamUserId === u.id ? styles.active : ""}`}
                style={{ background: teamColors[u.username.toLowerCase()] || "#6a737b" }}
                title={u.displayName}
                onClick={() => {
                  setBucket("open");
                  setTeamUserId(teamUserId === u.id ? null : u.id);
                  setNarrowStatus(null);
                }}
              >
                {initials(u.displayName, null)}
              </button>
            ))}
          </div>

          <div className={styles.divider} />
          <div className={styles.catLabel}>Status</div>
          <div className={styles.statusRow}>
            {(
              [
                [null, "All active"],
                ["open", "Open"],
                ["in_progress", "In progress"],
                ["waiting", "Waiting"],
                ["resolved", "Resolved"],
              ] as const
            ).map(([val, label]) => (
              <button
                key={label}
                type="button"
                className={`${styles.statusBtn} ${
                  val == null ? (allActiveHighlight ? styles.active : "") : narrowStatus === val ? styles.active : ""
                }`}
                onClick={() => {
                  if (val == null) {
                    setNarrowStatus(null);
                    setBucket("open");
                  } else {
                    setNarrowStatus(val);
                  }
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div className={styles.sidebarFooter}>
            <Link href="/inbox/settings" className={styles.mutedLink}>
              Inbox settings →
            </Link>
          </div>
        </aside>

        <div className={styles.listPanel}>
          <div className={styles.listToolbar}>
            <input
              className={styles.search}
              placeholder="Search tickets…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search tickets"
            />
            <select className={styles.sortSel} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="priority">Highest priority</option>
              <option value="updated">Recently updated</option>
            </select>
          </div>
          <div className={styles.ticketList}>
            {listLoading && tickets.length === 0 ? (
              <div className={styles.emptyDetail}>Loading…</div>
            ) : null}
            {tickets.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`${styles.ticketRow} ${selectedId === t.id ? styles.active : ""}`}
                onClick={() => openTicket(t.id)}
              >
                <span className={styles.priBar} style={{ background: priorityBarClass(t.priority) }} />
                {!t.is_read ? <span className={styles.unreadDot} aria-hidden /> : <span style={{ width: 8 }} />}
                <div className={styles.ticketMain}>
                  <div className={styles.ticketTop}>
                    <p className={`${styles.sender} ${!t.is_read ? styles.unread : ""}`}>{t.sender_name || t.sender_email}</p>
                    <span className={styles.time}>{relativeTime(t.received_at)}</span>
                  </div>
                  <p className={styles.subject}>{t.subject || "(No subject)"}</p>
                  <p className={styles.preview}>{t.body_preview || ""}</p>
                  <div className={styles.ticketMeta}>
                    <span
                      className={styles.catBadge}
                      style={{
                        background: (CAT_STYLE[t.category] || CAT_STYLE.other).bg,
                        color: (CAT_STYLE[t.category] || CAT_STYLE.other).color,
                      }}
                    >
                      {t.category}
                    </span>
                    <span
                      className={styles.assignAv}
                      style={{
                        background: t.assignee_name ? "#1b2856" : "#9e9e9e",
                      }}
                      title={t.assignee_name || "Unassigned"}
                    >
                      {t.assignee_name ? initials(t.assignee_name, null) : "?"}
                    </span>
                    <button
                      type="button"
                      className={styles.starBtn}
                      aria-label={t.is_starred ? "Unstar" : "Star"}
                      onClick={(e) => toggleStar(e, t)}
                    >
                      {t.is_starred ? "★" : "☆"}
                    </button>
                  </div>
                </div>
              </button>
            ))}
            {tickets.length === 0 && !listLoading ? (
              <div className={styles.emptyDetail}>No tickets match.</div>
            ) : null}
            {offset < total ? (
              <div className={styles.loadMore}>
                <button type="button" onClick={() => loadList(offset, true)} disabled={listLoading}>
                  {listLoading ? "Loading…" : "Load more"}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className={styles.detailPanel}>
          <div className={styles.detailBack}>
            <button type="button" className={styles.backBtn} onClick={closeMobileDetail}>
              ← Back
            </button>
          </div>
          {!selectedId || !detail ? (
            <div className={styles.detailScroll}>
              <p className={styles.emptyDetail}>{detailLoading ? "Loading…" : "Select a ticket to view details"}</p>
            </div>
          ) : (
            <div className={styles.detailBodyColumn}>
              <div className={styles.detailScroll}>
                <div className={styles.detailHead}>
                  <h2>{detail.subject || "(No subject)"}</h2>
                  <p className={styles.metaLine}>
                    From: {detail.sender_name || "—"} &lt;{detail.sender_email || ""}&gt;
                  </p>
                  <p className={styles.metaLine}>To: {detail.recipient_emails || "—"}</p>
                  <p className={styles.metaLine}>
                    Received: {detail.received_at ? new Date(detail.received_at).toLocaleString() : "—"}
                  </p>
                  <button
                    type="button"
                    className={styles.starBtn}
                    style={{ fontSize: "1.25rem" }}
                    onClick={(e) => toggleStar(e, detail)}
                  >
                    {detail.is_starred ? "★ Starred" : "☆ Star"}
                  </button>
                </div>

                {detail.ai_summary ? (
                  <div className={styles.aiBox}>
                    <strong>AI summary:</strong> {detail.ai_summary}
                    <div className={styles.chips}>
                      {detail.linked_property_name ? (
                        <span className={styles.chip}>Property: {detail.linked_property_name}</span>
                      ) : null}
                      {detail.linked_tenant_name ? (
                        <span className={styles.chip}>Tenant: {detail.linked_tenant_name}</span>
                      ) : null}
                      {detail.linked_owner_name ? (
                        <span className={styles.chip}>Owner: {detail.linked_owner_name}</span>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div
                  className={styles.bodyHtml}
                  dangerouslySetInnerHTML={{
                    __html: sanitizeEmailHtml(detail.body_html || "<p>(No body)</p>"),
                  }}
                />

                {responses.length > 0 ? (
                  <div className={styles.threadBlock}>
                    <h3 style={{ fontSize: "0.95rem", marginBottom: "0.5rem" }}>Thread & notes</h3>
                    {responses.map((r) => (
                      <div key={r.id} className={styles.threadItem}>
                        <div className={styles.threadMeta}>
                          {r.response_type === "reply" ? "Reply" : "Note"} · {r.responded_by_name || "—"} ·{" "}
                          {new Date(r.created_at).toLocaleString()}
                        </div>
                        <div>{r.body}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className={styles.actionBar}>
                <label>
                  Status
                  <select
                    value={detail.status}
                    onChange={(e) => updateTicket({ status: e.target.value })}
                  >
                    <option value="open">Open</option>
                    <option value="in_progress">In progress</option>
                    <option value="waiting">Waiting</option>
                    <option value="resolved">Resolved</option>
                  </select>
                </label>
                <label>
                  Assigned to
                  <select
                    value={detail.assigned_to ?? ""}
                    onChange={(e) =>
                      updateTicket({
                        assignedTo: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  >
                    <option value="">Unassigned</option>
                    {teamUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Priority
                  <select
                    value={priorityTier(detail.priority)}
                    onChange={(e) => updateTicket({ priority: Number(e.target.value) })}
                  >
                    <option value={95}>Urgent</option>
                    <option value={75}>High</option>
                    <option value={50}>Normal</option>
                    <option value={25}>Low</option>
                  </select>
                </label>
                <label>
                  Category
                  <select value={detail.category} onChange={(e) => updateTicket({ category: e.target.value })}>
                    {[
                      "maintenance",
                      "leasing",
                      "accounting",
                      "owner",
                      "tenant",
                      "vendor",
                      "legal",
                      "internal",
                      "marketing",
                      "other",
                    ].map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className={styles.composeDock}>
                <div className={styles.compose}>
                  <div className={styles.tabs}>
                    <button
                      type="button"
                      className={`${styles.tabBtn} ${composeMode === "reply" ? styles.active : ""}`}
                      onClick={() => {
                        setComposeMode("reply");
                        setComposeExpanded(false);
                      }}
                    >
                      Reply
                    </button>
                    <button
                      type="button"
                      className={`${styles.tabBtn} ${composeMode === "note" ? styles.active : ""}`}
                      onClick={() => {
                        setComposeMode("note");
                        setComposeExpanded(false);
                      }}
                    >
                      Internal note
                    </button>
                  </div>
                  <textarea
                    className={!composeExpanded ? styles.composeCollapsed : undefined}
                    value={composeBody}
                    onChange={(e) => {
                      setComposeBody(e.target.value);
                      if (e.target.value.length > 0) setComposeExpanded(true);
                    }}
                    onFocus={() => setComposeExpanded(true)}
                    placeholder={
                      composeMode === "reply" ? "Reply…" : "Internal note (not emailed)…"
                    }
                    rows={composeExpanded ? 6 : 1}
                    aria-label={composeMode === "reply" ? "Reply" : "Internal note"}
                  />
                  {composeMode === "reply" && composeExpanded ? (
                    <>
                      <label className={styles.sigEditLabel} htmlFor="inbox-reply-sig">
                        Signature (this reply)
                      </label>
                      <textarea
                        id="inbox-reply-sig"
                        className={styles.sigEditArea}
                        value={replySigDraft}
                        onChange={(e) => setReplySigDraft(e.target.value)}
                        placeholder="Optional — HTML signature appended after --"
                        spellCheck={false}
                        aria-label="Email signature for this reply"
                      />
                      {replySigDraft.trim() ? (
                        <div className={styles.replyPreview}>
                          <div style={{ fontSize: "0.72rem", color: "#6a737b", marginBottom: "0.35rem" }}>
                            Preview
                          </div>
                          <div style={{ marginBottom: "0.35rem", color: "#1b2856", fontSize: "0.88rem" }}>
                            {composeBody.trim() ? (
                              composeBody.trim().split("\n").map((line, i) => (
                                <span key={i}>
                                  {i > 0 ? <br /> : null}
                                  {line}
                                </span>
                              ))
                            ) : (
                              <span style={{ fontStyle: "italic", color: "#9aa0a6" }}>Your message</span>
                            )}
                          </div>
                          <p style={{ margin: "0.25rem 0", fontSize: "0.75rem", color: "#9aa0a6" }}>--</p>
                          <div
                            className={styles.replyPreviewMuted}
                            dangerouslySetInnerHTML={{
                              __html: sanitizeEmailHtml(replySigDraft),
                            }}
                          />
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  {composeExpanded ? (
                    <button
                      type="button"
                      className={styles.sendBtn}
                      disabled={composeBusy || !composeBody.trim()}
                      onClick={sendCompose}
                    >
                      {composeMode === "reply" ? "Send reply" : "Add note"}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
