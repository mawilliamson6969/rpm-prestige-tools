"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { apiUrl } from "../../lib/api";
import { parseApiError } from "../../lib/apiResult";
import type { TeamUser } from "./types";

const ALLOWLIST = new Set(["mike", "lori", "leslie", "amanda", "amelia"]);

export type UseTeamUsers = {
  teamUsers: TeamUser[];
  loading: boolean;
  error: string | null;
};

export default function useTeamUsers(): UseTeamUsers {
  const { authHeaders } = useAuth();
  const [teamUsers, setTeamUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl("/eos/team-users"), { headers: { ...authHeaders() } });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(parseApiError(body, res.status));
          return;
        }
        if (Array.isArray(body.users)) {
          setTeamUsers(
            (body.users as TeamUser[]).filter((u) => ALLOWLIST.has(u.username.toLowerCase()))
          );
        }
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load team.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authHeaders]);

  return { teamUsers, loading, error };
}
