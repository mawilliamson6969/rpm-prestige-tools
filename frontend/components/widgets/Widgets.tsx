"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import styles from "./widgets.module.css";
import { formatCurrency, timeAgo, useWidgetData } from "./useWidgetData";
import {
  QUICK_STAT_METRICS,
  type CardSize,
  type HubWidgetLayout,
} from "../../lib/layoutPrefs";

type WrapperProps = {
  title: string;
  icon: string;
  editMode?: boolean;
  onHide?: () => void;
  onSizeChange?: (size: CardSize) => void;
  size?: CardSize;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  draggable?: boolean;
  renderConfig?: () => ReactNode;
  hidden?: boolean;
  children: ReactNode;
  footer?: ReactNode;
};

export function WidgetWrapper({
  title,
  icon,
  editMode,
  onHide,
  onSizeChange,
  size = "medium",
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  draggable,
  renderConfig,
  hidden,
  children,
  footer,
}: WrapperProps) {
  const [sizeOpen, setSizeOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);

  return (
    <div
      className={`${styles.widget} ${hidden ? styles.hidden : ""}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      {editMode ? (
        <>
          <span className={styles.editOverlay} aria-hidden />
          <span className={styles.dragHandle} aria-label="Drag to reorder" title="Drag">
            ⋮⋮
          </span>
          <div className={styles.editBar}>
            <button
              type="button"
              className={styles.editBtn}
              title="Change size"
              onClick={() => {
                setSizeOpen((o) => !o);
                setConfigOpen(false);
              }}
              aria-label="Change size"
            >
              ⇔
            </button>
            {renderConfig ? (
              <button
                type="button"
                className={styles.editBtn}
                title="Configure"
                onClick={() => {
                  setConfigOpen((o) => !o);
                  setSizeOpen(false);
                }}
                aria-label="Configure"
              >
                ⚙
              </button>
            ) : null}
            {onHide ? (
              <button
                type="button"
                className={styles.editBtn}
                title="Hide"
                onClick={onHide}
                aria-label="Hide"
              >
                ✕
              </button>
            ) : null}
          </div>
          {sizeOpen && onSizeChange ? (
            <div className={styles.sizePopover}>
              {(["small", "medium", "large"] as CardSize[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`${styles.editBtn} ${s === size ? styles.editBtnActive : ""}`}
                  onClick={() => {
                    onSizeChange(s);
                    setSizeOpen(false);
                  }}
                  style={{ width: "auto", padding: "0 0.45rem", fontSize: "0.76rem" }}
                >
                  {s === "small" ? "S" : s === "medium" ? "M" : "L"}
                </button>
              ))}
            </div>
          ) : null}
          {configOpen && renderConfig ? (
            <div className={styles.configPopover}>{renderConfig()}</div>
          ) : null}
        </>
      ) : null}
      <div className={styles.header}>
        <h3 className={styles.title}>
          <span className={styles.icon} aria-hidden>
            {icon}
          </span>
          {title}
        </h3>
      </div>
      <div className={styles.content}>{children}</div>
      {footer ? footer : null}
    </div>
  );
}

type BaseProps = {
  widget: HubWidgetLayout;
  editMode?: boolean;
  onHide?: () => void;
  onSizeChange?: (size: CardSize) => void;
  onConfigChange?: (config: Record<string, unknown>) => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
};

function LoadingSkeleton() {
  return (
    <div>
      <div className={styles.skeletonLine} style={{ width: "100%" }} />
      <div className={styles.skeletonLine} style={{ width: "80%" }} />
      <div className={styles.skeletonLine} style={{ width: "60%" }} />
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className={styles.errorState}>
      <div>Unable to load widget</div>
      <button type="button" className={styles.retryBtn} onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

/* ==========  MY TASKS  ========== */

type MyTasksData = {
  items: {
    id: number;
    title: string;
    dueDate: string | null;
    priority: string;
    processName?: string | null;
    propertyName?: string | null;
  }[];
  total: number;
  overdue: number;
};

export function MyTasksWidget(props: BaseProps) {
  const limit = Number(props.widget.config?.limit ?? 5) || 5;
  const { data, loading, error, reload } = useWidgetData<MyTasksData>("my_tasks", { limit });
  const today = new Date().toISOString().slice(0, 10);

  const renderConfig = () => (
    <label>
      <span>Number of tasks</span>
      <select
        value={limit}
        onChange={(e) =>
          props.onConfigChange?.({ ...props.widget.config, limit: Number(e.target.value) })
        }
      >
        <option value="3">3</option>
        <option value="5">5</option>
        <option value="10">10</option>
      </select>
    </label>
  );

  return (
    <WidgetWrapper
      title="My Tasks"
      icon="📋"
      editMode={props.editMode}
      onHide={props.onHide}
      onSizeChange={props.onSizeChange}
      size={props.widget.size}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onDragEnd={props.onDragEnd}
      draggable={props.editMode}
      renderConfig={renderConfig}
      footer={
        data && data.total > 0 ? (
          <Link href="/operations/tasks" className={styles.footerLink}>
            View all {data.total} tasks →
          </Link>
        ) : null
      }
    >
      {loading && !data ? <LoadingSkeleton /> : null}
      {error ? <ErrorState onRetry={reload} /> : null}
      {data && data.items.length === 0 ? (
        <div className={styles.emptyState}>No tasks due. Nice work! 🎉</div>
      ) : null}
      {data && data.items.length > 0 ? (
        <ul className={styles.tasksList} style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {data.items.map((t) => {
            const overdue = t.dueDate && t.dueDate < today;
            const pClass =
              t.priority === "urgent"
                ? styles.taskPriorityUrgent
                : t.priority === "high"
                ? styles.taskPriorityHigh
                : t.priority === "low"
                ? styles.taskPriorityLow
                : styles.taskPriorityNormal;
            return (
              <li key={t.id} className={styles.taskRow}>
                <span className={styles.taskCheckbox} aria-hidden />
                <Link href="/operations/tasks" className={styles.taskTitle}>
                  {t.title}
                </Link>
                {t.dueDate ? (
                  <span className={`${styles.taskDue} ${overdue ? styles.taskDueOverdue : ""}`}>
                    {t.dueDate}
                  </span>
                ) : null}
                <span className={`${styles.taskPriorityDot} ${pClass}`} aria-hidden />
              </li>
            );
          })}
        </ul>
      ) : null}
    </WidgetWrapper>
  );
}

/* ==========  QUICK STAT  ========== */

type QuickStatData = {
  label: string;
  value: number;
  suffix?: string;
  prefix?: string;
  color?: "green" | "yellow" | "red" | "blue";
  trend?: string;
  trendDirection?: "up" | "down";
};

export function QuickStatWidget(props: BaseProps) {
  const metric = String(props.widget.config?.metric ?? "occupancy_rate");
  const { data, loading, error, reload } = useWidgetData<QuickStatData>("quick_stat", { metric });

  const renderConfig = () => (
    <label>
      <span>Metric</span>
      <select
        value={metric}
        onChange={(e) =>
          props.onConfigChange?.({ ...props.widget.config, metric: e.target.value })
        }
      >
        {QUICK_STAT_METRICS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
    </label>
  );

  const colorClass =
    data?.color === "green"
      ? styles.statValueGreen
      : data?.color === "yellow"
      ? styles.statValueYellow
      : data?.color === "red"
      ? styles.statValueRed
      : "";

  return (
    <WidgetWrapper
      title={data?.label || "Quick Stat"}
      icon="📊"
      editMode={props.editMode}
      onHide={props.onHide}
      onSizeChange={props.onSizeChange}
      size={props.widget.size}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onDragEnd={props.onDragEnd}
      draggable={props.editMode}
      renderConfig={renderConfig}
    >
      {loading && !data ? <LoadingSkeleton /> : null}
      {error ? <ErrorState onRetry={reload} /> : null}
      {data ? (
        <div className={styles.statBody}>
          <div className={styles.statLabel}>{data.label}</div>
          <div className={`${styles.statValue} ${colorClass}`}>
            {data.prefix ?? ""}
            {typeof data.value === "number" ? data.value.toLocaleString("en-US") : data.value}
            {data.suffix ?? ""}
          </div>
          {data.trend ? (
            <div
              className={`${styles.statTrend} ${
                data.trendDirection === "up" ? styles.statTrendUp : styles.statTrendDown
              }`}
            >
              {data.trendDirection === "up" ? "▲" : "▼"} {data.trend}
            </div>
          ) : null}
        </div>
      ) : null}
    </WidgetWrapper>
  );
}

/* ==========  RECENT ACTIVITY  ========== */

type ActivityData = {
  items: { type: string; user: string | null; description: string; timestamp: string }[];
};

export function RecentActivityWidget(props: BaseProps) {
  const limit = Number(props.widget.config?.limit ?? 10) || 10;
  const { data, loading, error, reload } = useWidgetData<ActivityData>("recent_activity", { limit });

  const renderConfig = () => (
    <label>
      <span>Entries</span>
      <select
        value={limit}
        onChange={(e) =>
          props.onConfigChange?.({ ...props.widget.config, limit: Number(e.target.value) })
        }
      >
        <option value="5">5</option>
        <option value="10">10</option>
        <option value="20">20</option>
      </select>
    </label>
  );

  return (
    <WidgetWrapper
      title="Recent Activity"
      icon="🔔"
      editMode={props.editMode}
      onHide={props.onHide}
      onSizeChange={props.onSizeChange}
      size={props.widget.size}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onDragEnd={props.onDragEnd}
      draggable={props.editMode}
      renderConfig={renderConfig}
      footer={
        <Link href="/operations/tasks" className={styles.footerLink}>
          View all activity →
        </Link>
      }
    >
      {loading && !data ? <LoadingSkeleton /> : null}
      {error ? <ErrorState onRetry={reload} /> : null}
      {data && data.items.length === 0 ? (
        <div className={styles.emptyState}>No recent activity.</div>
      ) : null}
      {data ? (
        <div className={styles.activityList}>
          {data.items.map((a, i) => {
            const dotClass =
              a.type === "task_completed"
                ? styles.activityDotComplete
                : a.type === "announcement_posted"
                ? styles.activityDotAnnouncement
                : styles.activityDotProcess;
            return (
              <div key={`${a.timestamp}-${i}`} className={styles.activityRow}>
                <span className={`${styles.activityDot} ${dotClass}`} aria-hidden />
                <span className={styles.activityDesc}>
                  {a.user ? <strong>{a.user}: </strong> : null}
                  {a.description}
                </span>
                <span className={styles.activityTime}>{timeAgo(a.timestamp)}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </WidgetWrapper>
  );
}

/* ==========  OPEN WORK ORDERS  ========== */

type WOData = {
  total: number;
  byStatus: Record<string, number>;
  urgent: number;
};

const WO_COLORS: Record<string, string> = {
  New: "#0098d0",
  Assigned: "#1b2856",
  Scheduled: "#1a7f4c",
  Estimated: "#c5960c",
};

export function OpenWorkOrdersWidget(props: BaseProps) {
  const { data, loading, error, reload } = useWidgetData<WOData>("open_work_orders");

  return (
    <WidgetWrapper
      title="Open Work Orders"
      icon="🔧"
      editMode={props.editMode}
      onHide={props.onHide}
      onSizeChange={props.onSizeChange}
      size={props.widget.size}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onDragEnd={props.onDragEnd}
      draggable={props.editMode}
      footer={
        <Link href="/dashboard?tab=maintenance" className={styles.footerLink}>
          View in Maintenance Dashboard →
        </Link>
      }
    >
      {loading && !data ? <LoadingSkeleton /> : null}
      {error ? <ErrorState onRetry={reload} /> : null}
      {data ? (
        <>
          <div className={styles.woTotal}>{data.total}</div>
          <div className={styles.woBar} aria-hidden>
            {Object.entries(data.byStatus).map(([status, count]) => (
              <div
                key={status}
                className={styles.woBarSegment}
                style={{
                  flex: count,
                  background: WO_COLORS[status] || "#6a737b",
                }}
                title={`${status}: ${count}`}
              />
            ))}
          </div>
          <div className={styles.woLegend}>
            {Object.entries(data.byStatus).map(([status, count]) => (
              <span key={status} className={styles.woLegendItem}>
                <span
                  className={styles.woLegendDot}
                  style={{ background: WO_COLORS[status] || "#6a737b" }}
                />
                {status} {count}
              </span>
            ))}
          </div>
          {data.urgent > 0 ? (
            <div className={styles.woUrgent}>⚠ {data.urgent} urgent</div>
          ) : null}
        </>
      ) : null}
    </WidgetWrapper>
  );
}

/* ==========  DELINQUENCY SUMMARY  ========== */

type DelinquencyData = {
  total: number;
  accountCount: number;
  aging: { current: number; thirty: number; sixty: number; ninety: number };
  inCollections: number;
};

export function DelinquencySummaryWidget(props: BaseProps) {
  const { data, loading, error, reload } = useWidgetData<DelinquencyData>("delinquency_summary");

  return (
    <WidgetWrapper
      title="Delinquency Summary"
      icon="💰"
      editMode={props.editMode}
      onHide={props.onHide}
      onSizeChange={props.onSizeChange}
      size={props.widget.size}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onDragEnd={props.onDragEnd}
      draggable={props.editMode}
      footer={
        <Link href="/dashboard?tab=finance" className={styles.footerLink}>
          View details →
        </Link>
      }
    >
      {loading && !data ? <LoadingSkeleton /> : null}
      {error ? <ErrorState onRetry={reload} /> : null}
      {data ? (
        <>
          <div
            className={`${styles.delinquencyTotal} ${
              data.total > 20000 ? styles.delinquencyTotalRed : ""
            }`}
          >
            {formatCurrency(data.total)}
          </div>
          <div className={styles.agingRow}>
            <div className={`${styles.agingCell} ${styles.agingCellCurrent}`}>
              <span className={styles.agingLabel}>Current</span>
              {formatCurrency(data.aging.current)}
            </div>
            <div className={`${styles.agingCell} ${styles.agingCell30}`}>
              <span className={styles.agingLabel}>30+</span>
              {formatCurrency(data.aging.thirty)}
            </div>
            <div className={`${styles.agingCell} ${styles.agingCell60}`}>
              <span className={styles.agingLabel}>60+</span>
              {formatCurrency(data.aging.sixty)}
            </div>
            <div className={`${styles.agingCell} ${styles.agingCell90}`}>
              <span className={styles.agingLabel}>90+</span>
              {formatCurrency(data.aging.ninety)}
            </div>
          </div>
          <div style={{ fontSize: "0.78rem", color: "#6a737b", marginTop: "0.35rem" }}>
            {data.accountCount} accounts
            {data.inCollections > 0 ? ` · ${data.inCollections} in collections` : ""}
          </div>
        </>
      ) : null}
    </WidgetWrapper>
  );
}

/* ==========  LEASE EXPIRATIONS  ========== */

type LeaseData = {
  next30: number;
  next60: number;
  next90: number;
  notRenewed: number;
  monthToMonth: number;
};

export function LeaseExpirationsWidget(props: BaseProps) {
  const { data, loading, error, reload } = useWidgetData<LeaseData>("lease_expirations");

  return (
    <WidgetWrapper
      title="Lease Expirations"
      icon="📅"
      editMode={props.editMode}
      onHide={props.onHide}
      onSizeChange={props.onSizeChange}
      size={props.widget.size}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onDragEnd={props.onDragEnd}
      draggable={props.editMode}
      footer={
        <Link href="/dashboard?tab=leasing" className={styles.footerLink}>
          View in Leasing Dashboard →
        </Link>
      }
    >
      {loading && !data ? <LoadingSkeleton /> : null}
      {error ? <ErrorState onRetry={reload} /> : null}
      {data ? (
        <>
          <div className={styles.leaseCols}>
            <div className={styles.leaseCol}>
              <div className={styles.leaseNum}>{data.next30}</div>
              <div className={styles.leaseLabel}>30 Days</div>
            </div>
            <div className={styles.leaseCol}>
              <div className={styles.leaseNum}>{data.next60}</div>
              <div className={styles.leaseLabel}>60 Days</div>
            </div>
            <div className={styles.leaseCol}>
              <div className={styles.leaseNum}>{data.next90}</div>
              <div className={styles.leaseLabel}>90 Days</div>
            </div>
          </div>
          {data.notRenewed > 0 ? (
            <div className={`${styles.leaseNote} ${styles.leaseNoteWarn}`}>
              ⚠ {data.notRenewed} not renewed
            </div>
          ) : null}
          <div className={styles.leaseNote}>{data.monthToMonth} month-to-month</div>
        </>
      ) : null}
    </WidgetWrapper>
  );
}

/* ==========  UNREAD INBOX  ========== */

type InboxData = {
  unreadCount: number;
  recent: { subject: string | null; from: string | null; receivedAt: string | null }[];
};

export function UnreadInboxWidget(props: BaseProps) {
  const { data, loading, error, reload } = useWidgetData<InboxData>("unread_inbox");

  return (
    <WidgetWrapper
      title="Unread Inbox"
      icon="📧"
      editMode={props.editMode}
      onHide={props.onHide}
      onSizeChange={props.onSizeChange}
      size={props.widget.size}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onDragEnd={props.onDragEnd}
      draggable={props.editMode}
      footer={
        <Link href="/inbox" className={styles.footerLink}>
          Open Inbox →
        </Link>
      }
    >
      {loading && !data ? <LoadingSkeleton /> : null}
      {error ? <ErrorState onRetry={reload} /> : null}
      {data ? (
        <>
          <div className={styles.inboxBadge}>{data.unreadCount}</div>
          {data.recent.length === 0 ? (
            <div className={styles.emptyState}>Inbox zero — nothing new.</div>
          ) : (
            <div className={styles.inboxList}>
              {data.recent.map((m, i) => (
                <Link key={i} href="/inbox" className={styles.inboxRow}>
                  <span className={styles.inboxSubject}>
                    {m.subject || "(No subject)"}
                  </span>
                  <span className={styles.inboxMeta}>
                    <span>{m.from || "—"}</span>
                    <span>{timeAgo(m.receivedAt)}</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </>
      ) : null}
    </WidgetWrapper>
  );
}

/* ==========  ACTIVE PROCESSES  ========== */

type ProcessData = {
  total: number;
  byTemplate: { template: string; count: number; overdue: number }[];
  overdue: number;
};

export function ActiveProcessesWidget(props: BaseProps) {
  const { data, loading, error, reload } = useWidgetData<ProcessData>("active_processes");

  return (
    <WidgetWrapper
      title="Active Processes"
      icon="⚙️"
      editMode={props.editMode}
      onHide={props.onHide}
      onSizeChange={props.onSizeChange}
      size={props.widget.size}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onDragEnd={props.onDragEnd}
      draggable={props.editMode}
      footer={
        <Link href="/operations/processes" className={styles.footerLink}>
          View all processes →
        </Link>
      }
    >
      {loading && !data ? <LoadingSkeleton /> : null}
      {error ? <ErrorState onRetry={reload} /> : null}
      {data && data.byTemplate.length === 0 ? (
        <div className={styles.emptyState}>No active processes.</div>
      ) : null}
      {data ? (
        <div className={styles.processList}>
          {data.byTemplate.map((t) => (
            <div
              key={t.template}
              className={`${styles.processRow} ${t.overdue > 0 ? styles.processRowOverdue : ""}`}
            >
              <span className={styles.processName}>{t.template}</span>
              <span className={styles.processCount}>{t.count}</span>
              {t.overdue > 0 ? (
                <span className={styles.processOverdueBadge}>{t.overdue} overdue</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </WidgetWrapper>
  );
}

/* ==========  ANNOUNCEMENTS  ========== */

type AnnouncementsData = {
  items: {
    id: string;
    title: string;
    content: string;
    author: string | null;
    createdAt: string;
  }[];
};

export function AnnouncementsWidget(props: BaseProps) {
  const limit = Number(props.widget.config?.limit ?? 3) || 3;
  const { data, loading, error, reload } = useWidgetData<AnnouncementsData>("announcements", {
    limit,
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const renderConfig = () => (
    <label>
      <span>Count</span>
      <select
        value={limit}
        onChange={(e) =>
          props.onConfigChange?.({ ...props.widget.config, limit: Number(e.target.value) })
        }
      >
        <option value="3">3</option>
        <option value="5">5</option>
      </select>
    </label>
  );

  return (
    <WidgetWrapper
      title="Announcements"
      icon="📢"
      editMode={props.editMode}
      onHide={props.onHide}
      onSizeChange={props.onSizeChange}
      size={props.widget.size}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onDragEnd={props.onDragEnd}
      draggable={props.editMode}
      renderConfig={renderConfig}
      footer={
        <Link href="/announcements" className={styles.footerLink}>
          View all →
        </Link>
      }
    >
      {loading && !data ? <LoadingSkeleton /> : null}
      {error ? <ErrorState onRetry={reload} /> : null}
      {data && data.items.length === 0 ? (
        <div className={styles.emptyState}>No announcements.</div>
      ) : null}
      {data ? (
        <div className={styles.announceList}>
          {data.items.map((a) => (
            <button
              key={a.id}
              type="button"
              className={styles.announceItem}
              style={{ textAlign: "left", border: "none", cursor: "pointer", width: "100%" }}
              onClick={() => setExpandedId(expandedId === a.id ? null : a.id)}
            >
              <div className={styles.announceTitle}>{a.title}</div>
              <div className={styles.announceMeta}>
                {a.author ? `${a.author} · ` : ""}
                {new Date(a.createdAt).toLocaleDateString()}
              </div>
              {expandedId === a.id ? (
                <div className={styles.announceContent}>{a.content}</div>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </WidgetWrapper>
  );
}

/* ==========  RECENT SUBMISSIONS  ========== */

type SubmissionsData = {
  items: {
    id: number;
    formName: string | null;
    contactName: string;
    submittedAt: string;
    status: string;
  }[];
};

export function RecentSubmissionsWidget(props: BaseProps) {
  const limit = Number(props.widget.config?.limit ?? 5) || 5;
  const { data, loading, error, reload } = useWidgetData<SubmissionsData>("recent_submissions", {
    limit,
  });

  const renderConfig = () => (
    <label>
      <span>Count</span>
      <select
        value={limit}
        onChange={(e) =>
          props.onConfigChange?.({ ...props.widget.config, limit: Number(e.target.value) })
        }
      >
        <option value="5">5</option>
        <option value="10">10</option>
      </select>
    </label>
  );

  return (
    <WidgetWrapper
      title="Recent Submissions"
      icon="📝"
      editMode={props.editMode}
      onHide={props.onHide}
      onSizeChange={props.onSizeChange}
      size={props.widget.size}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onDragEnd={props.onDragEnd}
      draggable={props.editMode}
      renderConfig={renderConfig}
      footer={
        <Link href="/admin/forms" className={styles.footerLink}>
          View all submissions →
        </Link>
      }
    >
      {loading && !data ? <LoadingSkeleton /> : null}
      {error ? <ErrorState onRetry={reload} /> : null}
      {data && data.items.length === 0 ? (
        <div className={styles.emptyState}>No recent submissions.</div>
      ) : null}
      {data ? (
        <div className={styles.submissionList}>
          {data.items.map((s) => (
            <Link key={s.id} href="/admin/forms" className={styles.submissionRow}>
              <div className={styles.submissionInfo}>
                <div className={styles.submissionForm}>{s.formName || "Form"}</div>
                <div className={styles.submissionContact}>
                  {s.contactName} · {timeAgo(s.submittedAt)}
                </div>
              </div>
              <span className={styles.submissionStatus}>{s.status}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </WidgetWrapper>
  );
}

export function renderWidget(widget: HubWidgetLayout, shared: Omit<BaseProps, "widget">) {
  const props = { widget, ...shared };
  switch (widget.widgetId) {
    case "my_tasks":
      return <MyTasksWidget {...props} />;
    case "quick_stat":
      return <QuickStatWidget {...props} />;
    case "recent_activity":
      return <RecentActivityWidget {...props} />;
    case "open_work_orders":
      return <OpenWorkOrdersWidget {...props} />;
    case "delinquency_summary":
      return <DelinquencySummaryWidget {...props} />;
    case "lease_expirations":
      return <LeaseExpirationsWidget {...props} />;
    case "unread_inbox":
      return <UnreadInboxWidget {...props} />;
    case "active_processes":
      return <ActiveProcessesWidget {...props} />;
    case "announcements":
      return <AnnouncementsWidget {...props} />;
    case "recent_submissions":
      return <RecentSubmissionsWidget {...props} />;
    default:
      return null;
  }
}
