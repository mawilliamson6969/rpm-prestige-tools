"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./dashboards.module.css";
import { apiUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import type { CalendarItem } from "@/types/mb";

const POLL_MS = 60_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type ViewMode = "month" | "week";

/**
 * Read-only calendar. Built without a date library — the math is small
 * (start-of-month, day-of-week, week boundaries). All dates rendered in
 * the user's local time. Date plotting reads each item's "primary date
 * column" value, which the backend already resolved per board.
 */
export default function CalendarDashboardClient({
  scope = "all",
  boardSlug,
}: {
  scope?: "all" | "board";
  boardSlug?: string;
}) {
  const { authHeaders, token } = useAuth();
  const [anchor, setAnchor] = useState<Date>(() => startOfMonth(new Date()));
  const [view, setView] = useState<ViewMode>("month");
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filterBoard, setFilterBoard] = useState("all");
  const [filterOwner, setFilterOwner] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const scopeParam = scope === "board" && boardSlug ? `board:${boardSlug}` : "all";

  const { from, to, title } = useMemo(() => {
    if (view === "month") {
      const monthStart = startOfMonth(anchor);
      const monthEnd = endOfMonth(anchor);
      // Pad to whole weeks so the grid shows context days.
      const gridStart = startOfWeek(monthStart);
      const gridEnd = endOfWeek(monthEnd);
      return {
        from: isoDate(gridStart),
        to: isoDate(gridEnd),
        title: `${MONTH_NAMES[anchor.getMonth()]} ${anchor.getFullYear()}`,
      };
    }
    const weekStart = startOfWeek(anchor);
    const weekEnd = endOfWeek(anchor);
    return {
      from: isoDate(weekStart),
      to: isoDate(weekEnd),
      title: `Week of ${MONTH_NAMES[weekStart.getMonth()].slice(0, 3)} ${weekStart.getDate()}`,
    };
  }, [anchor, view]);

  const load = useCallback(async () => {
    if (!token) return;
    setErr(null);
    try {
      const res = await fetch(
        apiUrl(
          `/mb/dashboards/calendar?scope=${encodeURIComponent(scopeParam)}&from=${from}&to=${to}`
        ),
        { headers: { ...authHeaders() }, cache: "no-store" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Calendar fetch failed (${res.status}).`);
      }
      const body: { items: CalendarItem[] } = await res.json();
      setItems(body.items || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load calendar.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, from, scopeParam, to, token]);

  useEffect(() => {
    load();
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (filterBoard !== "all" && it.board_slug !== filterBoard) return false;
      if (filterStatus !== "all" && it.status_value !== filterStatus) return false;
      if (filterOwner !== "all") {
        const ownerId = filterOwner === "none" ? null : Number(filterOwner);
        if (filterOwner === "none" ? it.owner != null : it.owner !== ownerId) return false;
      }
      return true;
    });
  }, [items, filterBoard, filterOwner, filterStatus]);

  // Bucket items by ISO date.
  const itemsByDate = useMemo(() => {
    const m = new Map<string, CalendarItem[]>();
    for (const it of filtered) {
      const key = it.date_value.slice(0, 10);
      const arr = m.get(key) ?? [];
      arr.push(it);
      m.set(key, arr);
    }
    return m;
  }, [filtered]);

  // Filter option lists derived from current data set.
  const boardOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of items) m.set(it.board_slug, it.board_name);
    return Array.from(m.entries());
  }, [items]);
  const statusOptions = useMemo(() => {
    const m = new Map<string, { label: string; color: string }>();
    for (const it of items) {
      if (it.status_value && !m.has(it.status_value)) {
        m.set(it.status_value, {
          label: it.status_label ?? it.status_value,
          color: it.status_color,
        });
      }
    }
    return Array.from(m.entries());
  }, [items]);
  const ownerOptions = useMemo(() => {
    const seen = new Set<number>();
    for (const it of items) if (typeof it.owner === "number") seen.add(it.owner);
    return Array.from(seen.values());
  }, [items]);

  function goPrev() {
    setAnchor((a) =>
      view === "month"
        ? new Date(a.getFullYear(), a.getMonth() - 1, 1)
        : new Date(a.getFullYear(), a.getMonth(), a.getDate() - 7)
    );
  }
  function goNext() {
    setAnchor((a) =>
      view === "month"
        ? new Date(a.getFullYear(), a.getMonth() + 1, 1)
        : new Date(a.getFullYear(), a.getMonth(), a.getDate() + 7)
    );
  }
  function goToday() {
    setAnchor(view === "month" ? startOfMonth(new Date()) : startOfWeek(new Date()));
  }

  return (
    <div className={styles.main}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>📅 Calendar</h1>
          <p className={styles.subtitle}>
            {scope === "board"
              ? "This board's items, plotted by primary date."
              : "Items across all boards, plotted by their primary date column."}
          </p>
        </div>
      </div>

      <div className={styles.calendarHeader}>
        <button type="button" className={styles.navBtn} onClick={goPrev}>
          ←
        </button>
        <span className={styles.calendarTitle}>{title}</span>
        <button type="button" className={styles.navBtn} onClick={goNext}>
          →
        </button>
        <button type="button" className={`${styles.navBtn} ${styles.todayBtn}`} onClick={goToday}>
          Today
        </button>
        <div className={styles.viewToggle}>
          <button
            type="button"
            className={`${styles.viewToggleBtn} ${view === "month" ? styles.viewToggleActive : ""}`}
            onClick={() => setView("month")}
          >
            Month
          </button>
          <button
            type="button"
            className={`${styles.viewToggleBtn} ${view === "week" ? styles.viewToggleActive : ""}`}
            onClick={() => setView("week")}
          >
            Week
          </button>
        </div>
      </div>

      <div className={styles.filterRow}>
        {scope === "all" && boardOptions.length > 1 ? (
          <>
            <span className={styles.filterLabel}>Board</span>
            <select
              className={styles.filterSelect}
              value={filterBoard}
              onChange={(e) => setFilterBoard(e.target.value)}
            >
              <option value="all">All boards</option>
              {boardOptions.map(([slug, name]) => (
                <option key={slug} value={slug}>
                  {name}
                </option>
              ))}
            </select>
          </>
        ) : null}
        {statusOptions.length > 0 ? (
          <>
            <span className={styles.filterLabel}>Status</span>
            <select
              className={styles.filterSelect}
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="all">All</option>
              {statusOptions.map(([v, o]) => (
                <option key={v} value={v}>
                  {o.label}
                </option>
              ))}
            </select>
          </>
        ) : null}
        {ownerOptions.length > 0 ? (
          <>
            <span className={styles.filterLabel}>Owner</span>
            <select
              className={styles.filterSelect}
              value={filterOwner}
              onChange={(e) => setFilterOwner(e.target.value)}
            >
              <option value="all">All</option>
              <option value="none">Unassigned</option>
              {ownerOptions.map((id) => (
                <option key={id} value={String(id)}>
                  User #{id}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </div>

      {err ? <div className={styles.errBanner}>{err}</div> : null}

      <div className={styles.calendarWrap}>
        <div className={styles.weekdayRow}>
          {WEEKDAYS.map((d) => (
            <div key={d} className={styles.weekdayCell}>
              {d}
            </div>
          ))}
        </div>
        {view === "month" ? (
          <MonthGrid
            anchor={anchor}
            itemsByDate={itemsByDate}
            onDayClick={(iso) => setExpandedDay(iso)}
          />
        ) : (
          <WeekGrid
            anchor={anchor}
            itemsByDate={itemsByDate}
            onDayClick={(iso) => setExpandedDay(iso)}
          />
        )}
      </div>

      {loading ? <div className={styles.overflowNote}>Loading…</div> : null}

      {expandedDay ? (
        <DayPopup
          dateIso={expandedDay}
          items={itemsByDate.get(expandedDay) ?? []}
          onClose={() => setExpandedDay(null)}
        />
      ) : null}
    </div>
  );
}

function MonthGrid({
  anchor,
  itemsByDate,
  onDayClick,
}: {
  anchor: Date;
  itemsByDate: Map<string, CalendarItem[]>;
  onDayClick: (iso: string) => void;
}) {
  const gridStart = startOfWeek(startOfMonth(anchor));
  const gridEnd = endOfWeek(endOfMonth(anchor));
  const days: Date[] = [];
  for (let d = new Date(gridStart); d <= gridEnd; d = addDays(d, 1)) {
    days.push(new Date(d));
  }
  const todayIso = isoDate(new Date());
  const currentMonth = anchor.getMonth();
  return (
    <div className={styles.monthGrid}>
      {days.map((d) => {
        const iso = isoDate(d);
        const dayItems = itemsByDate.get(iso) ?? [];
        const inMonth = d.getMonth() === currentMonth;
        const isToday = iso === todayIso;
        return (
          <DayCell
            key={iso}
            date={d}
            iso={iso}
            inMonth={inMonth}
            isToday={isToday}
            items={dayItems}
            onClick={() => onDayClick(iso)}
            maxChips={3}
          />
        );
      })}
    </div>
  );
}

function WeekGrid({
  anchor,
  itemsByDate,
  onDayClick,
}: {
  anchor: Date;
  itemsByDate: Map<string, CalendarItem[]>;
  onDayClick: (iso: string) => void;
}) {
  const weekStart = startOfWeek(anchor);
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) days.push(addDays(weekStart, i));
  const todayIso = isoDate(new Date());
  return (
    <div className={styles.weekGrid}>
      {days.map((d) => {
        const iso = isoDate(d);
        return (
          <DayCell
            key={iso}
            date={d}
            iso={iso}
            inMonth
            isToday={iso === todayIso}
            items={itemsByDate.get(iso) ?? []}
            onClick={() => onDayClick(iso)}
            maxChips={8}
          />
        );
      })}
    </div>
  );
}

function DayCell({
  date,
  iso,
  inMonth,
  isToday,
  items,
  onClick,
  maxChips,
}: {
  date: Date;
  iso: string;
  inMonth: boolean;
  isToday: boolean;
  items: CalendarItem[];
  onClick: () => void;
  maxChips: number;
}) {
  const visible = items.slice(0, maxChips);
  const hidden = items.length - visible.length;
  return (
    <div
      className={`${styles.dayCell} ${!inMonth ? styles.dayOtherMonth : ""} ${isToday ? styles.dayToday : ""}`}
    >
      <span
        className={`${styles.dayNumber} ${isToday ? styles.dayNumberToday : ""}`}
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
      >
        {date.getDate()}
      </span>
      {visible.map((it) => (
        <Link
          key={it.id}
          href={`/operations/boards/${it.board_slug}/items/${it.id}`}
          className={styles.dayChip}
          style={{ background: it.status_color }}
          title={`${it.title} — ${it.board_name}`}
        >
          {it.title}
        </Link>
      ))}
      {hidden > 0 ? (
        <button type="button" className={styles.dayMoreBtn} onClick={onClick}>
          +{hidden} more…
        </button>
      ) : null}
    </div>
  );
}

function DayPopup({
  dateIso,
  items,
  onClose,
}: {
  dateIso: string;
  items: CalendarItem[];
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const d = new Date(dateIso + "T00:00:00");
  return (
    <div className={styles.dayPopup} onClick={onClose}>
      <div className={styles.dayPopupCard} onClick={(e) => e.stopPropagation()}>
        <div className={styles.dayPopupHead}>
          <h3 className={styles.dayPopupTitle}>
            {d.toLocaleDateString(undefined, {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </h3>
          <button type="button" className={styles.dayPopupClose} onClick={onClose}>
            ×
          </button>
        </div>
        <div className={styles.dayPopupBody}>
          {items.length === 0 ? (
            <div style={{ color: "#6a737b", fontStyle: "italic" }}>No items.</div>
          ) : (
            items.map((it) => (
              <Link
                key={it.id}
                href={`/operations/boards/${it.board_slug}/items/${it.id}`}
                className={styles.dayPopupItem}
              >
                <span
                  className={styles.statusChip}
                  style={{ background: it.status_color }}
                >
                  {it.status_label || "—"}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: "#1b2856" }}>
                    {it.title}
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "#6a737b" }}>
                    {it.board_name}
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ===== date helpers =====

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setDate(x.getDate() - x.getDay());
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfWeek(d: Date): Date {
  const x = startOfWeek(d);
  x.setDate(x.getDate() + 6);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
