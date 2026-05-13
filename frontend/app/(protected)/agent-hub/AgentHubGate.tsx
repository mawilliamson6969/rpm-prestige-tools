"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../../../context/AuthContext";
import { agentHubFetch, type HubPermissions } from "../../../lib/agentHub";
import styles from "./agentHub.module.css";

type Props = {
  children: (perms: HubPermissions) => ReactNode;
};

/**
 * Wraps every Agent Hub page. Loads /agent-hub/permissions/me and either
 * renders children with the perms passed in, or shows a "no access" splash.
 *
 * The backend is the source of truth — this is purely UX. The render-prop
 * pattern (children receives perms) avoids prop-drilling perms through
 * every component.
 */
export default function AgentHubGate({ children }: Props) {
  const { token, authHeaders, user } = useAuth();
  const [perms, setPerms] = useState<HubPermissions | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancel = false;
    (async () => {
      try {
        const body = await agentHubFetch<{ permissions: HubPermissions | null }>(
          "/agent-hub/permissions/me",
          { authHeaders: authHeaders() }
        );
        if (cancel) return;
        setPerms(body.permissions);
      } catch (e) {
        if (cancel) return;
        setErr(e instanceof Error ? e.message : "Could not load permissions.");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [token, authHeaders]);

  if (loading) {
    return (
      <div className={styles.shell}>
        <div className={styles.muted}>Loading Agent Hub…</div>
      </div>
    );
  }
  if (err) {
    return (
      <div className={styles.shell}>
        <div className={styles.error}>{err}</div>
      </div>
    );
  }
  if (!perms) {
    return (
      <div className={styles.shell}>
        <div className={styles.card}>
          <h2 className={styles.pageTitle}>No Agent Hub access</h2>
          <p className={styles.muted}>
            You don't have access to the Agent Hub yet. Ask Mike or Lori to grant access.
          </p>
          <p className={styles.muted}>
            Logged in as: <strong>{user?.displayName || user?.username}</strong>
          </p>
        </div>
      </div>
    );
  }
  return <>{children(perms)}</>;
}
