"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import {
  agentHubFetch,
  ACTIVITY_ICONS,
  ACTIVITY_TYPE_LABELS,
  relativeTime,
  type ActivityType,
  type Agent,
  type Brokerage,
  type HubPermissions,
} from "../../../../lib/agentHub";
import AgentHubGate from "../AgentHubGate";
import { TierBadge } from "../components";
import styles from "../agentHub.module.css";

type SearchResults = {
  query: string;
  agents: (Agent & { rank: number })[];
  brokerages: Brokerage[];
  activities: { id: number; agent_id: number; agent_name: string; type: ActivityType; subject: string | null; summary: string | null; occurred_at: string; snippet: string; rank: number }[];
};

const RECENT_KEY = "rpm_agent_hub_recent_search";

function SearchInner({ perms }: { perms: HubPermissions }) {
  const { authHeaders, token } = useAuth();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    } catch {
      return [];
    }
  });

  // Debounced search
  useEffect(() => {
    if (!token) return;
    if (q.trim().length < 2) {
      setResults(null);
      setErr(null);
      return;
    }
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const body = await agentHubFetch<SearchResults>(`/agent-hub/search?q=${encodeURIComponent(q.trim())}`, {
          authHeaders: authHeaders(),
        });
        setResults(body);
        setErr(null);
        // Bump recent searches
        if (q.trim().length >= 3) {
          const next = [q.trim(), ...recent.filter((x) => x !== q.trim())].slice(0, 8);
          setRecent(next);
          try {
            localStorage.setItem(RECENT_KEY, JSON.stringify(next));
          } catch {
            /* ignore */
          }
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Search failed.");
      } finally {
        setBusy(false);
      }
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, token]);

  return (
    <div className={styles.shell}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Search</h1>
          <p className={styles.pageSubtitle}>Agents, brokerages, and activity content.</p>
        </div>
      </div>

      <input
        autoFocus
        className={styles.input}
        placeholder="Search by name, email, license, brokerage, MLS ID, or activity content…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ fontSize: "1rem", padding: "0.75rem", marginBottom: "1rem" }}
      />

      {q.trim().length < 2 ? (
        <div className={styles.card}>
          <div className={styles.cardTitle}>Recent searches</div>
          {recent.length === 0 ? (
            <div className={styles.muted}>No recent searches yet. Type at least 2 characters above.</div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
              {recent.map((r) => (
                <button key={r} className={styles.btn} onClick={() => setQ(r)}>{r}</button>
              ))}
            </div>
          )}
        </div>
      ) : busy ? (
        <div className={styles.muted}>Searching…</div>
      ) : err ? (
        <div className={styles.error}>{err}</div>
      ) : results ? (
        <div className={styles.flexCol}>
          <div className={styles.card}>
            <div className={styles.cardTitle}>Agents ({results.agents.length})</div>
            {results.agents.length === 0 ? (
              <div className={styles.muted}>No matching agents.</div>
            ) : (
              <div className={styles.flexCol} style={{ gap: 0 }}>
                {results.agents.map((a) => (
                  <Link key={a.id} href={`/agent-hub/agents/${a.id}`} className={styles.row} style={{ padding: "0.5rem 0", borderBottom: "1px solid #f3f4f6", textDecoration: "none", color: "inherit" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500 }}>{a.full_name}</div>
                      <div className={styles.muted} style={{ fontSize: "0.78rem" }}>
                        {a.brokerage_name || "—"}{a.email ? ` · ${a.email}` : ""}{a.license_number ? ` · #${a.license_number}` : ""}
                      </div>
                    </div>
                    <TierBadge tier={a.tier} />
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>Brokerages ({results.brokerages.length})</div>
            {results.brokerages.length === 0 ? (
              <div className={styles.muted}>No matching brokerages.</div>
            ) : (
              results.brokerages.map((b) => (
                <Link key={b.id} href={`/agent-hub/brokerages/${b.id}`} className={styles.linkCell} style={{ display: "block", padding: "0.4rem 0", borderBottom: "1px solid #f3f4f6" }}>
                  {b.name} <span className={styles.muted}>· {b.city || "—"}</span>
                </Link>
              ))
            )}
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>Activity matches ({results.activities.length})</div>
            {results.activities.length === 0 ? (
              <div className={styles.muted}>No matching activities.</div>
            ) : (
              results.activities.map((a) => (
                <Link key={a.id} href={`/agent-hub/agents/${a.agent_id}`} style={{ display: "block", padding: "0.5rem 0", borderBottom: "1px solid #f3f4f6", textDecoration: "none", color: "inherit" }}>
                  <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", fontSize: "0.85rem" }}>
                    <span aria-hidden>{ACTIVITY_ICONS[a.type]}</span>
                    <strong>{a.agent_name}</strong>
                    <span className={styles.muted}>· {ACTIVITY_TYPE_LABELS[a.type]} · {relativeTime(a.occurred_at)}</span>
                  </div>
                  {a.subject ? <div style={{ marginTop: "0.2rem", fontWeight: 500 }}>{a.subject}</div> : null}
                  <div className={styles.muted} style={{ fontSize: "0.85rem" }} dangerouslySetInnerHTML={{ __html: a.snippet }} />
                </Link>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function AgentHubSearchPage() {
  return <AgentHubGate>{(perms) => <SearchInner perms={perms} />}</AgentHubGate>;
}
