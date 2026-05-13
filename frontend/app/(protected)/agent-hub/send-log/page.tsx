"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import { agentHubFetch, relativeTime, type HubPermissions, type SendLogEntry } from "../../../../lib/agentHub";
import AgentHubGate from "../AgentHubGate";
import styles from "../agentHub.module.css";

const STATUS_ICON: Record<string, string> = {
  sent: "📤",
  delivered: "✅",
  opened: "👁",
  clicked: "🔗",
  replied: "↩️",
  bounced: "⚠️",
  failed: "❌",
  unknown: "❓",
};

function SendLogInner({ perms: _perms }: { perms: HubPermissions }) {
  const { authHeaders, token } = useAuth();
  const [list, setList] = useState<SendLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ channel: "", delivery_status: "" });
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancel = false;
    setLoading(true);
    (async () => {
      try {
        const sp = new URLSearchParams();
        if (filter.channel) sp.set("channel", filter.channel);
        if (filter.delivery_status) sp.set("delivery_status", filter.delivery_status);
        sp.set("page", String(page));
        const body = await agentHubFetch<{ logs: SendLogEntry[]; total: number }>(`/agent-hub/send-log?${sp}`, { authHeaders: authHeaders() });
        if (cancel) return;
        setList(body.logs);
        setTotal(body.total);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [token, authHeaders, filter, page]);

  return (
    <div className={styles.shell}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Send Log</h1>
          <p className={styles.pageSubtitle}>{total} message{total === 1 ? "" : "s"}</p>
        </div>
      </div>
      <div className={styles.filterBar}>
        <select className={styles.select} value={filter.channel} onChange={(e) => { setPage(1); setFilter({ ...filter, channel: e.target.value }); }}>
          <option value="">All channels</option>
          <option value="email">Email</option>
          <option value="sms">SMS</option>
          <option value="postcard">Postcard</option>
          <option value="letter">Letter</option>
        </select>
        <select className={styles.select} value={filter.delivery_status} onChange={(e) => { setPage(1); setFilter({ ...filter, delivery_status: e.target.value }); }}>
          <option value="">All statuses</option>
          <option value="sent">Sent</option>
          <option value="delivered">Delivered</option>
          <option value="opened">Opened</option>
          <option value="replied">Replied</option>
          <option value="bounced">Bounced</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {loading ? <div className={styles.muted}>Loading…</div> : null}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th></th>
              <th>Agent</th>
              <th>Channel</th>
              <th>Subject / Preview</th>
              <th>Sent</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && !loading ? (
              <tr><td colSpan={6} className={styles.empty}>No sends yet.</td></tr>
            ) : (
              list.map((l) => (
                <>
                  <tr key={l.id} onClick={() => setExpanded(expanded === l.id ? null : l.id)} style={{ cursor: "pointer" }}>
                    <td>{STATUS_ICON[l.delivery_status] || "?"}</td>
                    <td>
                      <Link href={`/agent-hub/agents/${l.agent_id}`} className={styles.linkCell} onClick={(e) => e.stopPropagation()}>
                        {l.agent_name}
                      </Link>
                    </td>
                    <td>{l.channel}</td>
                    <td style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {l.subject || (l.body ? l.body.slice(0, 80) : "—")}
                    </td>
                    <td>{relativeTime(l.sent_at)}</td>
                    <td>{l.delivery_status}</td>
                  </tr>
                  {expanded === l.id ? (
                    <tr key={`${l.id}-x`}>
                      <td colSpan={6} style={{ background: "#f9fafb", padding: "0.6rem" }}>
                        <div className={styles.muted} style={{ fontSize: "0.78rem" }}>
                          To: {l.to_address}{l.external_id ? ` · ext: ${l.external_id}` : ""}
                          {l.opened_at ? ` · opened ${relativeTime(l.opened_at)}` : ""}
                          {l.replied_at ? ` · replied ${relativeTime(l.replied_at)}` : ""}
                          {l.bounced_at ? ` · BOUNCED ${l.bounce_reason || ""}` : ""}
                        </div>
                        <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.85rem", marginTop: "0.4rem" }}>
                          {l.body || "(no body)"}
                        </pre>
                      </td>
                    </tr>
                  ) : null}
                </>
              ))
            )}
          </tbody>
        </table>
      </div>

      {total > 50 ? (
        <div className={styles.row} style={{ justifyContent: "center", marginTop: "1rem" }}>
          <button className={styles.btn} disabled={page === 1} onClick={() => setPage(page - 1)}>← Prev</button>
          <span className={styles.muted} style={{ fontSize: "0.85rem" }}>Page {page}</span>
          <button className={styles.btn} disabled={page * 50 >= total} onClick={() => setPage(page + 1)}>Next →</button>
        </div>
      ) : null}
    </div>
  );
}

export default function SendLogPage() {
  return <AgentHubGate>{(perms) => <SendLogInner perms={perms} />}</AgentHubGate>;
}
