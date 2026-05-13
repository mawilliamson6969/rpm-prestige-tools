"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { apiUrl } from "../../lib/api";
import { parseApiError } from "../../lib/apiResult";

export type AnalyticsWindow = "14d" | "30d" | "90d" | "ytd";

export type KpiSeries = {
  value: number | null;
  prior: number | null;
  spark: number[] | null;
};

export type AnalyticsKpis = {
  openConversations: KpiSeries;
  medianFirstReplySeconds: KpiSeries;
  medianResolutionSeconds: KpiSeries;
  slaHitPct: KpiSeries;
  conversationsPerDay: KpiSeries;
  csat: KpiSeries;
};

export type VolumePoint = { date: string; received: number; resolved: number };

export type ChannelSlice = {
  channel: string;
  count: number;
  pct: number;
};

export type TeamLoadRow = {
  userId: number;
  username: string;
  displayName: string;
  openCount: number;
  resolvedCount: number;
};

export type InboxHealthRow = {
  mailboxId: number;
  name: string;
  openCount: number;
  slaHitPct: number | null;
  medianFirstReplySeconds: number | null;
};

export type AnalyticsData = {
  kpis: AnalyticsKpis | null;
  volume: VolumePoint[];
  channels: { total: number; channels: ChannelSlice[] };
  teamLoad: TeamLoadRow[];
  inboxHealth: InboxHealthRow[];
  loading: boolean;
  error: string | null;
  forbidden: boolean;
  refetch: () => Promise<void>;
};

export default function useAnalytics(window: AnalyticsWindow): AnalyticsData {
  const { authHeaders, token } = useAuth();
  const [kpis, setKpis] = useState<AnalyticsKpis | null>(null);
  const [volume, setVolume] = useState<VolumePoint[]>([]);
  const [channels, setChannels] = useState<{ total: number; channels: ChannelSlice[] }>(
    { total: 0, channels: [] }
  );
  const [teamLoad, setTeamLoad] = useState<TeamLoadRow[]>([]);
  const [inboxHealth, setInboxHealth] = useState<InboxHealthRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const opts = { cache: "no-store" as const, headers: { ...authHeaders() } };
      const [rKpi, rVol, rCh, rTeam, rHealth] = await Promise.all([
        fetch(apiUrl(`/inbox/analytics/kpis?window=${window}`), opts),
        fetch(apiUrl(`/inbox/analytics/volume?window=${window}`), opts),
        fetch(apiUrl(`/inbox/analytics/channel-mix?window=${window}`), opts),
        fetch(apiUrl(`/inbox/analytics/team-load`), opts),
        fetch(apiUrl(`/inbox/analytics/inbox-health?window=${window}`), opts),
      ]);
      // A 403 on any endpoint means the user lacks reports.view — surface
      // a single "forbidden" state rather than five field errors.
      if ([rKpi, rVol, rCh, rTeam, rHealth].some((r) => r.status === 403)) {
        setForbidden(true);
        setKpis(null);
        setVolume([]);
        setChannels({ total: 0, channels: [] });
        setTeamLoad([]);
        setInboxHealth([]);
        return;
      }
      const [jKpi, jVol, jCh, jTeam, jHealth] = await Promise.all([
        rKpi.json().catch(() => ({})),
        rVol.json().catch(() => ({})),
        rCh.json().catch(() => ({})),
        rTeam.json().catch(() => ({})),
        rHealth.json().catch(() => ({})),
      ]);
      const errors = [
        [rKpi, jKpi] as const,
        [rVol, jVol] as const,
        [rCh, jCh] as const,
        [rTeam, jTeam] as const,
        [rHealth, jHealth] as const,
      ]
        .filter(([r]) => !r.ok)
        .map(([r, j]) => parseApiError(j, r.status));
      if (errors.length) {
        setError(errors[0]);
        return;
      }
      setKpis(jKpi.kpis || null);
      setVolume(Array.isArray(jVol.series) ? jVol.series : []);
      setChannels({
        total: jCh.total || 0,
        channels: Array.isArray(jCh.channels) ? jCh.channels : [],
      });
      setTeamLoad(Array.isArray(jTeam.rows) ? jTeam.rows : []);
      setInboxHealth(Array.isArray(jHealth.rows) ? jHealth.rows : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load analytics.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, window]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  return {
    kpis,
    volume,
    channels,
    teamLoad,
    inboxHealth,
    loading,
    error,
    forbidden,
    refetch: fetchAll,
  };
}
