"use client";

import { useMemo } from "react";
import useTeam from "../useTeam";
import type { TeamUser } from "./types";

export type UseTeamUsers = {
  teamUsers: TeamUser[];
  loading: boolean;
  error: string | null;
};

/**
 * Inbox-shaped wrapper over the platform-wide `useTeam` hook. Filters to active
 * team members (excludes external/staff role only — keeps owner/admin/csm/
 * maintenance/operations) so the assignee dropdown matches the people who
 * actually triage tickets.
 */
const TRIAGE_ROLES = new Set(["owner", "admin", "csm", "maintenance", "operations"]);

export default function useTeamUsers(): UseTeamUsers {
  const { team, loading, error } = useTeam();
  const teamUsers = useMemo<TeamUser[]>(
    () =>
      team
        .filter((m) => m.active && TRIAGE_ROLES.has(m.role))
        .map((m) => ({
          id: m.id,
          username: m.username,
          displayName: m.displayName,
          email: m.email,
        })),
    [team]
  );
  return { teamUsers, loading, error };
}
