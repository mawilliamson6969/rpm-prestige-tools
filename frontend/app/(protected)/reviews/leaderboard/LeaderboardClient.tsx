"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import { apiUrl } from "../../../../lib/api";
import ReviewsNav from "../ReviewsNav";
import StarRow from "../StarRow";
import { avatarColor, initialsOf } from "../utils";
import styles from "../reviews.module.css";

type LeaderRow = {
  user_id: number;
  display_name: string;
  username: string;
  rank: number;
  requests_sent: number;
  reviews_received: number;
  five_star_count: number;
  four_star_count: number;
  three_star_count: number;
  two_star_count: number;
  one_star_count: number;
  avg_rating: number;
  conversion_rate: number;
};

const PERIODS: { value: string; label: string }[] = [
  { value: "weekly", label: "This Week" },
  { value: "monthly", label: "This Month" },
  { value: "quarterly", label: "This Quarter" },
  { value: "yearly", label: "This Year" },
];

export default function LeaderboardClient() {
  const { authHeaders } = useAuth();
  const [period, setPeriod] = useState("monthly");
  const [leaders, setLeaders] = useState<LeaderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(apiUrl(`/reviews/leaderboard?period=${period}`), {
      headers: { ...authHeaders() },
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(body.leaderboard)) setLeaders(body.leaderboard);
    setLoading(false);
  }, [authHeaders, period]);

  useEffect(() => {
    load();
  }, [load]);

  const top = leaders[0];
  const totalReviews = leaders.reduce((s, r) => s + (r.reviews_received || 0), 0);
  const teamAvg =
    leaders.length > 0
      ? leaders.reduce((s, r) => s + Number(r.avg_rating || 0), 0) / leaders.length
      : 0;
  const bestConversion = leaders.slice().sort((a, b) => b.conversion_rate - a.conversion_rate)[0];

  return (
    <div className={styles.page}>
      <div className={styles.topRow}>
        <div>
          <h1 className={styles.title}>🏆 Reviews Leaderboard</h1>
          <p className={styles.sub}>Who's generating the most (and best) reviews?</p>
        </div>
        <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              className={`${styles.stepPill} ${period === p.value ? styles.stepPillActive : ""}`}
              onClick={() => setPeriod(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <ReviewsNav />

      {top ? (
        <div
          className={styles.card}
          style={{
            marginBottom: "1rem",
            background: "linear-gradient(135deg, rgba(255,215,0,0.14), rgba(0,152,208,0.08))",
            borderColor: "rgba(255,215,0,0.35)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <div
              className={styles.reviewAvatar}
              style={{ background: avatarColor(top.display_name), width: "3.25rem", height: "3.25rem" }}
            >
              {initialsOf(top.display_name)}
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: "1.15rem", color: "#1b2856" }}>
                🏆 Top Performer: {top.display_name}
              </div>
              <div style={{ fontSize: "0.9rem", color: "#6a737b", marginTop: "0.2rem" }}>
                {top.reviews_received} reviews · {Number(top.avg_rating || 0).toFixed(1)} avg rating ·{" "}
                {Number(top.conversion_rate || 0).toFixed(1)}% conversion
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <div className={styles.summaryCardLabel}>Team reviews</div>
          <div className={styles.summaryCardValue}>{totalReviews}</div>
          <div className={styles.summaryCardHint}>This period</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryCardLabel}>Team avg rating</div>
          <div className={styles.summaryCardValue}>{teamAvg.toFixed(1)}</div>
          <div className={styles.summaryCardHint}>Across all members</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryCardLabel}>Best conversion</div>
          <div className={styles.summaryCardValue}>
            {bestConversion ? `${Number(bestConversion.conversion_rate).toFixed(1)}%` : "—"}
          </div>
          <div className={styles.summaryCardHint}>
            {bestConversion?.display_name || ""}
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryCardLabel}>Active members</div>
          <div className={styles.summaryCardValue}>{leaders.length}</div>
          <div className={styles.summaryCardHint}>With requests sent</div>
        </div>
      </div>

      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : leaders.length === 0 ? (
        <div className={styles.emptyState}>
          <h3>No leaderboard data for this period</h3>
          <p>Send review requests and assign team members to populate the leaderboard.</p>
        </div>
      ) : (
        <table className={styles.leaderTable}>
          <thead>
            <tr>
              <th style={{ width: "3rem" }}>Rank</th>
              <th>Team Member</th>
              <th>Sent</th>
              <th>Reviews</th>
              <th>5★</th>
              <th>Avg</th>
              <th>Conversion</th>
            </tr>
          </thead>
          <tbody>
            {leaders.map((r) => {
              const medal =
                r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : null;
              const rankClass =
                r.rank === 1
                  ? styles.rankGold
                  : r.rank === 2
                  ? styles.rankSilver
                  : r.rank === 3
                  ? styles.rankBronze
                  : "";
              return (
                <tr key={r.user_id} className={rankClass}>
                  <td>
                    <span className={styles.rankMedal}>
                      {medal ? <span style={{ fontSize: "1rem" }}>{medal}</span> : null}
                      #{r.rank}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <div
                        className={styles.reviewAvatar}
                        style={{
                          width: "2rem",
                          height: "2rem",
                          fontSize: "0.75rem",
                          background: avatarColor(r.display_name),
                        }}
                      >
                        {initialsOf(r.display_name)}
                      </div>
                      <strong>{r.display_name}</strong>
                    </div>
                  </td>
                  <td>{r.requests_sent}</td>
                  <td>
                    <strong>{r.reviews_received}</strong>
                  </td>
                  <td>{r.five_star_count}</td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                      <StarRow rating={Math.round(Number(r.avg_rating))} />
                      <span>{Number(r.avg_rating || 0).toFixed(1)}</span>
                    </div>
                  </td>
                  <td>
                    <strong>{Number(r.conversion_rate || 0).toFixed(1)}%</strong>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
