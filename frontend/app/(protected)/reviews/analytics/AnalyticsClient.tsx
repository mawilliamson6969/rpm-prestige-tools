"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAuth } from "../../../../context/AuthContext";
import { apiUrl } from "../../../../lib/api";
import ReviewsNav from "../ReviewsNav";
import { starColor } from "../utils";
import styles from "../reviews.module.css";

type Analytics = {
  overview: {
    totalReviews: number;
    avgRating: number;
    totalRequests: number;
    overallConversion: number;
    responseRate: number;
    avgResponseTimeHours: number;
    ratingDistribution: Record<string, number>;
  };
  byTemplate: {
    templateId: number;
    name: string;
    sent: number;
    reviews: number;
    conversion: number;
    avgRating: number;
  }[];
  byChannel: Record<string, { sent: number; opened: number; clicked: number; reviews: number } | null>;
  byRecipientType: Record<string, { sent: number; reviews: number; avg_rating: number } | null>;
  overTime: { date: string; sent: number; reviews: number; avg_rating: number }[];
  bestPerforming: {
    bestTemplate: { name: string; conversion: number } | null;
    bestChannel: string | null;
    bestDayOfWeek: string | null;
    bestTimeOfDay: string | null;
    bestRecipientType: string | null;
  };
};

const PRESETS = [
  { label: "Last 7 Days", days: 7 },
  { label: "30 Days", days: 30 },
  { label: "90 Days", days: 90 },
  { label: "This Year", days: 365 },
];

export default function AnalyticsClient() {
  const { authHeaders } = useAuth();
  const [preset, setPreset] = useState<number>(90);
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const to = new Date();
    const from = new Date(Date.now() - preset * 24 * 3600 * 1000);
    const qs = `?from=${from.toISOString()}&to=${to.toISOString()}`;
    const res = await fetch(apiUrl(`/reviews/analytics${qs}`), { headers: { ...authHeaders() } });
    const body = await res.json().catch(() => ({}));
    if (res.ok) setData(body);
    setLoading(false);
  }, [authHeaders, preset]);

  useEffect(() => {
    load();
  }, [load]);

  const ratingChart = useMemo(() => {
    if (!data) return [];
    return [5, 4, 3, 2, 1].map((n) => ({
      rating: `${n}★`,
      count: data.overview.ratingDistribution[String(n)] || 0,
      fill: starColor(n),
    }));
  }, [data]);

  const channelChart = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.byChannel)
      .filter(([, v]) => v)
      .map(([k, v]) => ({ name: k, reviews: v!.reviews, sent: v!.sent }));
  }, [data]);

  const typeChart = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.byRecipientType)
      .filter(([, v]) => v)
      .map(([k, v]) => ({ name: k, reviews: v!.reviews }));
  }, [data]);

  const overTimeChart = useMemo(() => {
    if (!data) return [];
    return data.overTime.map((row) => ({
      date: row.date ? new Date(row.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "",
      sent: row.sent,
      reviews: row.reviews,
    }));
  }, [data]);

  const funnel = useMemo(() => {
    if (!data) return { sent: 0, opened: 0, clicked: 0, reviews: 0 };
    const email = data.byChannel.email;
    return {
      sent: email?.sent || 0,
      opened: email?.opened || 0,
      clicked: email?.clicked || 0,
      reviews: email?.reviews || 0,
    };
  }, [data]);

  return (
    <div className={styles.page}>
      <div className={styles.topRow}>
        <div>
          <h1 className={styles.title}>📊 Review Analytics</h1>
          <p className={styles.sub}>Understand which templates, channels, and times perform best.</p>
        </div>
        <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
          {PRESETS.map((p) => (
            <button
              key={p.days}
              type="button"
              className={`${styles.stepPill} ${preset === p.days ? styles.stepPillActive : ""}`}
              onClick={() => setPreset(p.days)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <ReviewsNav />

      {loading || !data ? (
        <div className={styles.loading}>Loading analytics…</div>
      ) : (
        <>
          <div className={styles.summaryGrid}>
            <div className={styles.summaryCard}>
              <div className={styles.summaryCardLabel}>Total reviews</div>
              <div className={styles.summaryCardValue}>{data.overview.totalReviews}</div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryCardLabel}>Avg rating</div>
              <div className={styles.summaryCardValue}>
                {Number(data.overview.avgRating).toFixed(1)} ★
              </div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryCardLabel}>Requests sent</div>
              <div className={styles.summaryCardValue}>{data.overview.totalRequests}</div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryCardLabel}>Conversion rate</div>
              <div className={styles.summaryCardValue}>
                {Number(data.overview.overallConversion).toFixed(1)}%
              </div>
              <div className={styles.summaryCardHint}>Requests → reviews</div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryCardLabel}>Response rate</div>
              <div className={styles.summaryCardValue}>
                {Number(data.overview.responseRate).toFixed(1)}%
              </div>
              <div className={styles.summaryCardHint}>Reviews we've replied to</div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryCardLabel}>Avg response time</div>
              <div className={styles.summaryCardValue}>
                {Number(data.overview.avgResponseTimeHours || 0).toFixed(1)}h
              </div>
            </div>
          </div>

          {data.bestPerforming.bestTemplate ? (
            <div className={styles.insightCallout}>
              📊 <strong>Insight:</strong> "{data.bestPerforming.bestTemplate.name}" has the highest
              conversion at <strong>{data.bestPerforming.bestTemplate.conversion.toFixed(1)}%</strong>.
            </div>
          ) : null}
          {data.bestPerforming.bestChannel ? (
            <div className={styles.insightCallout}>
              💡 <strong>Best channel:</strong>{" "}
              <strong>{data.bestPerforming.bestChannel.toUpperCase()}</strong> — use it for higher
              conversion.
            </div>
          ) : null}
          {data.bestPerforming.bestDayOfWeek ? (
            <div className={styles.insightCallout}>
              📆 <strong>Best day to send:</strong> {data.bestPerforming.bestDayOfWeek}
              {data.bestPerforming.bestTimeOfDay
                ? ` · Best time: ${data.bestPerforming.bestTimeOfDay}`
                : ""}
              .
            </div>
          ) : null}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div className={styles.chartCard}>
              <h3>Reviews over time</h3>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={overTimeChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(27,40,86,0.08)" />
                  <XAxis dataKey="date" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="sent" stroke="#6a737b" name="Sent" />
                  <Line type="monotone" dataKey="reviews" stroke="#0098D0" name="Reviews" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className={styles.chartCard}>
              <h3>Rating distribution</h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={ratingChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(27,40,86,0.08)" />
                  <XAxis dataKey="rating" fontSize={12} />
                  <YAxis fontSize={11} />
                  <Tooltip />
                  <Bar dataKey="count">
                    {ratingChart.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className={styles.chartCard}>
              <h3>Reviews by channel</h3>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={channelChart} dataKey="reviews" nameKey="name" outerRadius={80} label>
                    {channelChart.map((_, i) => (
                      <Cell
                        key={i}
                        fill={["#0098D0", "#10b981", "#6a11cb"][i % 3]}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className={styles.chartCard}>
              <h3>Reviews by recipient type</h3>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={typeChart} dataKey="reviews" nameKey="name" outerRadius={80} label>
                    {typeChart.map((_, i) => (
                      <Cell
                        key={i}
                        fill={["#1B2856", "#B32317", "#2E7D6B"][i % 3]}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className={styles.chartCard} style={{ marginTop: "1rem" }}>
            <h3>Email funnel: Sent → Opened → Clicked → Review</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.65rem" }}>
              {[
                { label: "Sent", value: funnel.sent, color: "#6a737b" },
                { label: "Opened", value: funnel.opened, color: "#0098D0" },
                { label: "Clicked", value: funnel.clicked, color: "#2E7D6B" },
                { label: "Reviews", value: funnel.reviews, color: "#10b981" },
              ].map((f) => (
                <div
                  key={f.label}
                  style={{
                    background: `${f.color}1a`,
                    border: `1px solid ${f.color}44`,
                    borderRadius: 10,
                    padding: "0.85rem 1rem",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: "0.72rem", color: "#6a737b", fontWeight: 700 }}>
                    {f.label.toUpperCase()}
                  </div>
                  <div style={{ fontSize: "1.6rem", fontWeight: 800, color: f.color }}>{f.value}</div>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.chartCard} style={{ marginTop: "1rem" }}>
            <h3>Template performance</h3>
            <table className={styles.templateTable}>
              <thead>
                <tr>
                  <th>Template</th>
                  <th>Sent</th>
                  <th>Reviews</th>
                  <th>Conversion</th>
                  <th>Avg Rating</th>
                </tr>
              </thead>
              <tbody>
                {data.byTemplate.map((t) => {
                  const c = t.conversion;
                  const color = c > 40 ? "#10b981" : c > 20 ? "#f59e0b" : "#ef4444";
                  return (
                    <tr key={t.templateId}>
                      <td>
                        <strong>{t.name}</strong>
                      </td>
                      <td>{t.sent}</td>
                      <td>{t.reviews || 0}</td>
                      <td style={{ color, fontWeight: 700 }}>{c.toFixed(1)}%</td>
                      <td>
                        {t.avgRating ? Number(t.avgRating).toFixed(1) : "—"}
                        {t.avgRating ? " ★" : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
