"use client";

import { useMemo, useState } from "react";
import styles from "../operations.module.css";
import type { ProcessRecord } from "../types";

type Props = {
  processes: ProcessRecord[];
  onOpenDay: (id: number) => void;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export default function CalendarView({ processes, onOpenDay }: Props) {
  const [dateField, setDateField] = useState<"targetCompletion" | "startedAt">("targetCompletion");
  const [cursor, setCursor] = useState<Date>(startOfMonth(new Date()));

  const { weeks } = useMemo(() => {
    const first = startOfMonth(cursor);
    const startWeekday = first.getDay();
    const startDate = new Date(first);
    startDate.setDate(first.getDate() - startWeekday);
    const result: Date[][] = [];
    const d = new Date(startDate);
    for (let w = 0; w < 6; w++) {
      const row: Date[] = [];
      for (let day = 0; day < 7; day++) {
        row.push(new Date(d));
        d.setDate(d.getDate() + 1);
      }
      result.push(row);
    }
    return { weeks: result };
  }, [cursor]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, ProcessRecord[]>();
    for (const p of processes) {
      const raw = dateField === "targetCompletion" ? p.targetCompletion : p.startedAt;
      if (!raw) continue;
      const d = new Date(raw);
      if (isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }, [processes, dateField]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div>
      <div className={styles.calendarToolbar}>
        <div style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            onClick={() => setCursor(addMonths(cursor, -1))}
          >
            ←
          </button>
          <strong style={{ color: "#1b2856" }}>
            {cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </strong>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            onClick={() => setCursor(addMonths(cursor, 1))}
          >
            →
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            onClick={() => setCursor(startOfMonth(new Date()))}
          >
            Today
          </button>
        </div>
        <select
          className={styles.select}
          value={dateField}
          onChange={(e) => setDateField(e.target.value as "targetCompletion" | "startedAt")}
        >
          <option value="targetCompletion">By target date</option>
          <option value="startedAt">By start date</option>
        </select>
      </div>
      <div className={styles.calendarGrid}>
        {WEEKDAYS.map((w) => (
          <div key={w} className={styles.calendarDayHeader}>
            {w}
          </div>
        ))}
        {weeks.flat().map((d) => {
          const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
          const events = eventsByDay.get(key) || [];
          const isCurrentMonth = d.getMonth() === cursor.getMonth();
          const isToday = d.getTime() === today.getTime();
          return (
            <div
              key={key}
              className={`${styles.calendarDay} ${!isCurrentMonth ? styles.calendarDayOther : ""} ${
                isToday ? styles.calendarDayToday : ""
              }`}
            >
              <div className={styles.calendarDayNumber}>{d.getDate()}</div>
              {events.slice(0, 3).map((p) => {
                const overdue =
                  p.targetCompletion &&
                  new Date(p.targetCompletion) < today &&
                  p.status === "active";
                return (
                  <div
                    key={p.id}
                    className={`${styles.calendarEvent} ${overdue ? styles.calendarEventOverdue : ""}`}
                    style={{ background: p.templateColor || "#0098D0" }}
                    onClick={() => onOpenDay(p.id)}
                    title={p.name}
                  >
                    {p.templateIcon ? `${p.templateIcon} ` : ""}
                    {p.name}
                  </div>
                );
              })}
              {events.length > 3 ? (
                <div style={{ fontSize: "0.7rem", color: "#6a737b" }}>
                  +{events.length - 3} more
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
