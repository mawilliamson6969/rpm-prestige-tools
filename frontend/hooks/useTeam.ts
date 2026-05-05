"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { apiUrl } from "../lib/api";
import type { AuthRole } from "../context/AuthContext";

export type TeamMember = {
  id: number;
  username: string;
  displayName: string;
  role: AuthRole;
  email: string | null;
  avatarUrl: string | null;
  active: boolean;
  created_at?: string;
  deactivatedAt?: string | null;
  lastLoginAt?: string | null;
};

export type UseTeam = {
  team: TeamMember[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
};

/**
 * Returns the active user list, used by assignee pickers and team displays.
 * Pass `{ includeInactive: true }` from admin views that need deactivated users
 * for management — non-admins get only active users regardless.
 */
export default function useTeam(opts?: { includeInactive?: boolean }): UseTeam {
  const { authHeaders, token } = useAuth();
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const includeInactive = !!opts?.includeInactive;

  const refetch = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const url = includeInactive ? "/users?include=inactive" : "/users";
      const res = await fetch(apiUrl(url), {
        cache: "no-store",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "Could not load team.");
        return;
      }
      setTeam(Array.isArray(body.users) ? (body.users as TeamMember[]) : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load team.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, includeInactive, token]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { team, loading, error, refetch };
}
