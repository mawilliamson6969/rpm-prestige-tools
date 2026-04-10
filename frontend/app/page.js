"use client";

import { useCallback, useEffect, useState } from "react";

const NAVY = "#003366";
const GOLD = "#C5960C";
const WHITE = "#FFFFFF";
const DOOR_GOAL = 300;

function occupancyApiUrl() {
  const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";
  if (base) return `${base}/dashboard/occupancy`;
  return "/api/dashboard/occupancy";
}

function cardStyle() {
  return {
    background: `linear-gradient(145deg, ${NAVY} 0%, #00264d 100%)`,
    border: `1px solid rgba(197, 150, 12, 0.35)`,
    borderRadius: 12,
    padding: "1.25rem 1.5rem",
    boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
  };
}

export default function Home() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(occupancyApiUrl(), { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          typeof body.error === "string"
            ? body.error
            : `Request failed (${res.status}). Check API credentials and AppFolio connectivity.`;
        throw new Error(msg);
      }
      setData(body);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Could not load dashboard data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const doorProgress = data
    ? Math.min(100, Math.round((data.totalUnitCount / DOOR_GOAL) * 1000) / 10)
    : 0;

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "1.75rem clamp(1rem, 4vw, 2.5rem)",
        fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
        backgroundColor: NAVY,
        color: WHITE,
      }}
    >
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "1rem",
          marginBottom: "1.75rem",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: "clamp(1.35rem, 3vw, 1.85rem)", fontWeight: 700 }}>
            RPM Prestige — Occupancy
          </h1>
          <p style={{ margin: "0.35rem 0 0", opacity: 0.88, fontSize: "0.95rem" }}>
            AppFolio snapshot (proof of concept)
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          {data?.refreshedAt && (
            <span style={{ fontSize: "0.85rem", opacity: 0.9 }}>
              Last refreshed: {new Date(data.refreshedAt).toLocaleString()}
            </span>
          )}
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            style={{
              background: GOLD,
              color: NAVY,
              border: "none",
              borderRadius: 8,
              padding: "0.45rem 1rem",
              fontWeight: 600,
              cursor: loading ? "wait" : "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          style={{
            background: "rgba(180, 40, 40, 0.2)",
            border: "1px solid rgba(255,120,120,0.5)",
            borderRadius: 10,
            padding: "1rem 1.25rem",
            marginBottom: "1.5rem",
            color: "#ffdede",
          }}
        >
          <strong style={{ color: WHITE }}>Connection error.</strong> {error}
        </div>
      )}

      {loading && !data && (
        <p style={{ opacity: 0.85 }}>Loading dashboard…</p>
      )}

      {data && (
        <>
          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "1.25rem",
              marginBottom: "2rem",
            }}
          >
            <div style={cardStyle()}>
              <div style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.06em", color: GOLD }}>
                Total doors
              </div>
              <div style={{ fontSize: "2.5rem", fontWeight: 800, lineHeight: 1.15, marginTop: 6 }}>
                {data.totalUnitCount}
              </div>
              <div style={{ fontSize: "0.8rem", opacity: 0.85, marginTop: 4 }}>
                Goal: {DOOR_GOAL} units
              </div>
              <div
                style={{
                  marginTop: 12,
                  height: 10,
                  borderRadius: 5,
                  background: "rgba(255,255,255,0.12)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${doorProgress}%`,
                    height: "100%",
                    background: GOLD,
                    borderRadius: 5,
                    transition: "width 0.4s ease",
                  }}
                />
              </div>
              <div style={{ fontSize: "0.75rem", opacity: 0.8, marginTop: 6 }}>{doorProgress}% of goal</div>
            </div>

            <div style={cardStyle()}>
              <div style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.06em", color: GOLD }}>
                Occupancy rate
              </div>
              <div style={{ fontSize: "2.5rem", fontWeight: 800, lineHeight: 1.15, marginTop: 6 }}>
                {data.occupancyRatePercent}%
              </div>
              <div style={{ fontSize: "0.85rem", opacity: 0.85, marginTop: 8 }}>
                {data.occupiedCount} occupied · {data.vacantCount} vacant
              </div>
            </div>

            <div style={cardStyle()}>
              <div style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.06em", color: GOLD }}>
                Vacant units
              </div>
              <div style={{ fontSize: "2.5rem", fontWeight: 800, lineHeight: 1.15, marginTop: 6 }}>
                {data.vacantCount}
              </div>
              <div style={{ fontSize: "0.85rem", opacity: 0.85, marginTop: 8 }}>Across all properties</div>
            </div>
          </section>

          <section style={cardStyle()}>
            <h2 style={{ margin: "0 0 1rem", fontSize: "1.1rem", color: GOLD }}>By property</h2>
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.9rem",
                }}
              >
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: `1px solid ${GOLD}` }}>
                    <th style={{ padding: "0.6rem 0.5rem 0.75rem 0" }}>Property</th>
                    <th style={{ padding: "0.6rem 0.5rem 0.75rem 0" }}>Units</th>
                    <th style={{ padding: "0.6rem 0 0.75rem 0.5rem" }}>Vacant</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byProperty?.map((row, idx) => (
                    <tr
                      key={`${row.propertyName}-${idx}`}
                      style={{ borderBottom: "1px solid rgba(255,255,255,0.12)" }}
                    >
                      <td style={{ padding: "0.65rem 0.5rem 0.65rem 0" }}>{row.propertyName}</td>
                      <td style={{ padding: "0.65rem 0.5rem" }}>{row.unitCount}</td>
                      <td style={{ padding: "0.65rem 0 0.65rem 0.5rem" }}>{row.vacantCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
