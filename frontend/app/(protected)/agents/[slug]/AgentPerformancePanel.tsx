"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type MetricRow = {
  metricDate: string;
  actionsTaken: number;
  actionsAutoSent: number;
  actionsQueued: number;
  humanOverrides: number;
  avgConfidenceScore: number | null;
  errors?: number;
};

type Props = {
  metrics: MetricRow[];
};

function toChartRows(m: MetricRow[]) {
  return m.map((r) => {
    const err = r.errors ?? 0;
    const successRate =
      r.actionsTaken > 0 ? Math.round(((r.actionsTaken - err) / r.actionsTaken) * 1000) / 10 : null;
    return {
      date: r.metricDate.slice(5),
      actions: r.actionsTaken,
      auto: r.actionsAutoSent,
      queued: r.actionsQueued,
      overrides: r.humanOverrides,
      confidence: r.avgConfidenceScore != null ? Number(r.avgConfidenceScore) : null,
      successRate,
    };
  });
}

export default function AgentPerformancePanel({ metrics }: Props) {
  const rows = toChartRows(metrics);
  const mid = Math.floor(rows.length / 2);
  const first = rows.slice(0, mid);
  const second = rows.slice(mid);
  const sum = (arr: typeof rows, key: keyof (typeof rows)[0]) =>
    arr.reduce((a, r) => a + (Number(r[key]) || 0), 0);
  const totalActions = sum(rows, "actions");
  const autoRate = totalActions > 0 ? Math.round((sum(rows, "auto") / totalActions) * 1000) / 10 : null;
  const prevActions = sum(first, "actions");
  const curActions = sum(second, "actions");
  const confRows = rows.filter((r) => r.confidence != null) as { confidence: number }[];
  const avgConf = confRows.length
    ? confRows.reduce((a, r) => a + r.confidence, 0) / confRows.length
    : null;

  return (
    <div>
      <div className="agentPerfSummary" style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem" }}>
        <Stat label="Total actions (period)" value={String(totalActions)} />
        <Stat label="Auto-send rate" value={autoRate != null ? `${autoRate}%` : "—"} />
        <Stat
          label="vs previous half"
          value={prevActions ? `${Math.round(((curActions - prevActions) / prevActions) * 100)}% change` : "—"}
        />
        <Stat label="Avg confidence (where set)" value={avgConf ? avgConf.toFixed(1) : "—"} />
      </div>

      <h4 style={{ margin: "0.5rem 0", color: "#1b2856" }}>Actions per day</h4>
      <div style={{ width: "100%", height: 240 }}>
        <ResponsiveContainer>
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Line type="monotone" dataKey="actions" stroke="#0098d0" strokeWidth={2} dot={false} name="Actions" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <h4 style={{ margin: "1rem 0 0.5rem", color: "#1b2856" }}>Auto vs queued vs overrides</h4>
      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer>
          <BarChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            <Bar dataKey="auto" stackId="a" fill="#1a7f4c" name="Auto-sent" />
            <Bar dataKey="queued" stackId="a" fill="#0098d0" name="Queued" />
            <Bar dataKey="overrides" stackId="a" fill="#c5960c" name="Human override" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <h4 style={{ margin: "1rem 0 0.5rem", color: "#1b2856" }}>Average confidence</h4>
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>
          <LineChart data={rows.filter((r) => r.confidence != null)}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Line type="monotone" dataKey="confidence" stroke="#1b2856" strokeWidth={2} dot={false} name="Avg confidence" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <h4 style={{ margin: "1rem 0 0.5rem", color: "#1b2856" }}>Success rate trend (non-error / total actions)</h4>
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>
          <LineChart data={rows.filter((r) => r.successRate != null)}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Line type="monotone" dataKey="successRate" stroke="#1a7f4c" strokeWidth={2} dot={false} name="Success %" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: "#f5f5f5",
        borderRadius: 10,
        padding: "0.55rem 0.85rem",
        border: "1px solid rgba(27,40,86,0.1)",
        minWidth: 140,
      }}
    >
      <div style={{ fontSize: "0.7rem", color: "#6a737b", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: "1rem", fontWeight: 800, color: "#1b2856" }}>{value}</div>
    </div>
  );
}
