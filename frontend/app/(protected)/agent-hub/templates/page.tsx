"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import { agentHubFetch, type HubPermissions, type Template } from "../../../../lib/agentHub";
import AgentHubGate from "../AgentHubGate";
import styles from "../agentHub.module.css";

const CHANNEL_ICONS: Record<string, string> = {
  email: "📧",
  sms: "💬",
  postcard: "📮",
  letter: "✉️",
};

function TemplatesInner({ perms }: { perms: HubPermissions }) {
  const { authHeaders, token } = useAuth();
  const [list, setList] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ channel: "" });

  useEffect(() => {
    if (!token) return;
    let cancel = false;
    setLoading(true);
    (async () => {
      try {
        const sp = new URLSearchParams();
        if (filter.channel) sp.set("channel", filter.channel);
        const body = await agentHubFetch<{ templates: Template[] }>(`/agent-hub/templates?${sp}`, {
          authHeaders: authHeaders(),
        });
        if (cancel) return;
        setList(body.templates);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [token, authHeaders, filter]);

  return (
    <div className={styles.shell}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Templates</h1>
          <p className={styles.pageSubtitle}>{list.length} template{list.length === 1 ? "" : "s"}</p>
        </div>
      </div>

      <div className={styles.filterBar}>
        <select className={styles.select} value={filter.channel} onChange={(e) => setFilter({ channel: e.target.value })}>
          <option value="">All channels</option>
          <option value="email">Email</option>
          <option value="sms">SMS</option>
          <option value="postcard">Postcard</option>
          <option value="letter">Letter</option>
        </select>
      </div>

      {loading ? <div className={styles.muted}>Loading…</div> : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "0.75rem" }}>
        {list.map((t) => (
          <Link key={t.id} href={`/agent-hub/templates/${t.id}`} className={styles.card} style={{ display: "block", textDecoration: "none", color: "inherit" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <span style={{ fontSize: "1.1rem" }}>{CHANNEL_ICONS[t.channel]}</span>
              <span style={{ fontWeight: 600 }}>{t.name}</span>
              {t.is_system ? <span style={{ marginLeft: "auto", padding: "0.05rem 0.35rem", borderRadius: 4, background: "#eef2f7", color: "#1b2856", fontSize: "0.65rem", fontWeight: 600 }}>SYS</span> : null}
            </div>
            <div className={styles.muted} style={{ fontSize: "0.78rem", marginTop: "0.25rem" }}>
              {t.channel} · {t.category || "general"}
            </div>
            {t.subject ? <div style={{ fontSize: "0.85rem", marginTop: "0.4rem", fontWeight: 500 }}>{t.subject}</div> : null}
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function TemplatesPage() {
  return <AgentHubGate>{(perms) => <TemplatesInner perms={perms} />}</AgentHubGate>;
}
