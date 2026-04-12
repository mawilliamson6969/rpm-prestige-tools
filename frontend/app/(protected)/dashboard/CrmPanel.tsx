"use client";

import styles from "./dashboard.module.css";

const GREY = "#6a737b";
const NAVY = "#1b2856";

type CrmPayload = {
  deals?: {
    total?: number;
    byStatus?: Record<string, number>;
    recentDeals?: Record<string, unknown>[];
  };
  tasks?: {
    total?: number;
    overdue?: number;
    dueThisWeek?: number;
    completedThisMonth?: number;
    recentTasks?: Record<string, unknown>[];
  };
  contacts?: {
    total?: number;
    byType?: Record<string, number>;
  };
  processes?: {
    total?: number;
    byStatus?: Record<string, number>;
    recentProcesses?: Record<string, unknown>[];
  };
  conversations?: {
    total?: number;
    open?: number;
  };
};

function str(o: unknown) {
  if (o == null) return "—";
  if (typeof o === "object") return JSON.stringify(o).slice(0, 120);
  return String(o);
}

function taskLabel(d: Record<string, unknown>) {
  const name = String(d.name ?? d.Name ?? "").trim();
  const due = d.due_date ?? d.dueDate;
  return name || str(due);
}

export default function CrmPanel(props: {
  crm: CrmPayload | null;
  loading: boolean;
  error: string | null;
}) {
  const { crm, loading, error } = props;

  if (loading && !crm) {
    return (
      <div className={styles.skeletonGrid}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={styles.skeleton} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.alert} role="alert">
        <strong>Could not load CRM.</strong> {error}
      </div>
    );
  }

  if (!crm) {
    return <p style={{ color: GREY }}>No CRM data yet. Sync LeadSimple from the admin refresh control.</p>;
  }

  const deals = crm.deals ?? {};
  const tasks = crm.tasks ?? {};
  const contacts = crm.contacts ?? {};
  const processes = crm.processes ?? {};
  const conversations = crm.conversations ?? {};

  return (
    <>
      <p style={{ fontSize: "0.85rem", color: GREY, marginTop: 0, marginBottom: "1rem" }}>
        LeadSimple CRM — counts and recents from cached sync (company-wide).
      </p>

      <div className={styles.grid4}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Deals (total)</div>
          <div className={styles.kpiValue}>{deals.total ?? 0}</div>
          <div className={styles.kpiSub}>
            {deals.byStatus
              ? Object.entries(deals.byStatus)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(" · ")
              : "—"}
          </div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Tasks</div>
          <div className={styles.kpiValue}>{tasks.total ?? 0}</div>
          <div className={styles.kpiSub}>
            Overdue {tasks.overdue ?? 0} · Due in 7d {tasks.dueThisWeek ?? 0} · Done (MTD){" "}
            {tasks.completedThisMonth ?? 0}
          </div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Contacts</div>
          <div className={styles.kpiValue}>{contacts.total ?? 0}</div>
          <div className={styles.kpiSub}>
            {contacts.byType
              ? Object.entries(contacts.byType)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(" · ")
              : "—"}
          </div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Conversations</div>
          <div className={styles.kpiValue}>{conversations.total ?? 0}</div>
          <div className={styles.kpiSub}>Open threads: {conversations.open ?? 0}</div>
        </div>
      </div>

      <div className={styles.grid4b}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Processes (total)</div>
          <div className={styles.kpiValue}>{processes.total ?? 0}</div>
          <div className={styles.kpiSub}>
            {processes.byStatus
              ? Object.entries(processes.byStatus)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(" · ")
              : "—"}
          </div>
        </div>
      </div>

      <div className={styles.chartRow}>
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>Recent deals</h3>
          {(deals.recentDeals?.length ?? 0) === 0 ? (
            <div className={styles.chartPlaceholder}>No deals in cache.</div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {(deals.recentDeals ?? []).slice(0, 20).map((row, i) => (
                    <tr key={i}>
                      <td>{String(row.name ?? row.Name ?? "—")}</td>
                      <td>{String(row.status ?? row.Status ?? "—")}</td>
                      <td style={{ color: NAVY, fontSize: "0.85rem" }}>
                        {String(row.updated_at ?? row.updatedAt ?? "—")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>Upcoming tasks (incomplete)</h3>
          {(tasks.recentTasks?.length ?? 0) === 0 ? (
            <div className={styles.chartPlaceholder}>No incomplete tasks with due dates, or cache empty.</div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Due</th>
                  </tr>
                </thead>
                <tbody>
                  {(tasks.recentTasks ?? []).slice(0, 20).map((row, i) => (
                    <tr key={i}>
                      <td>{taskLabel(row)}</td>
                      <td style={{ fontSize: "0.85rem" }}>{String(row.due_date ?? row.dueDate ?? "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className={styles.tableCard}>
        <h3 className={styles.chartTitle} style={{ marginBottom: "0.65rem" }}>
          Open processes (recent)
        </h3>
        {(processes.recentProcesses?.length ?? 0) === 0 ? (
          <p style={{ color: GREY }}>No open processes in cache.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {(processes.recentProcesses ?? []).slice(0, 20).map((row, i) => (
                  <tr key={i}>
                    <td>{String(row.name ?? row.Name ?? "—")}</td>
                    <td style={{ fontSize: "0.85rem" }}>{String(row.updated_at ?? row.updatedAt ?? "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
