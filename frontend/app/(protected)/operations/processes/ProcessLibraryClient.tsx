"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Briefcase,
  Building,
  Phone,
  Wrench,
  ArrowRight,
  Eye,
  RefreshCw,
  Inbox,
  ClipboardList,
  Search,
  Filter,
  User,
  Check,
  LayoutGrid,
  List,
  Plus,
  Download,
  Copy,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { apiUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import CreateProcessModal from "../CreateProcessModal";
import styles from "./process-library.module.css";

type TemplateRow = {
  templateId: number;
  name: string;
  slug: string | null;
  icon: string | null;
  color: string | null;
  category: string | null;
  isActive: boolean;
  activeCount: number;
  completedCount: number;
  completed30d: number;
  overdueCount: number;
  avgDays: number | null;
};

type DashboardPayload = {
  byTemplate: TemplateRow[];
  summary: {
    liveTemplates: number;
    inflight: number;
    overdue: number;
    completed30d: number;
    automationHitRate: number | null;
  };
};

const ICON_MAP: Record<string, LucideIcon> = {
  briefcase: Briefcase,
  building: Building,
  phone: Phone,
  wrench: Wrench,
  arrowR: ArrowRight,
  eye: Eye,
  refresh: RefreshCw,
  inbox: Inbox,
  clipboard: ClipboardList,
};

const STAGE_COLORS = [
  "var(--pms-stg-1)",
  "var(--pms-stg-2)",
  "var(--pms-stg-3)",
  "var(--pms-stg-4)",
  "var(--pms-stg-5)",
  "var(--pms-stg-6)",
];

function resolveColor(c: string | null, idx: number): string {
  if (c && c.startsWith("#")) return c;
  if (c && c.startsWith("--")) return `var(${c})`;
  return STAGE_COLORS[idx % STAGE_COLORS.length];
}

function resolveIcon(iconKey: string | null): LucideIcon {
  if (iconKey && ICON_MAP[iconKey]) return ICON_MAP[iconKey];
  return ClipboardList;
}

function formatCode(idx: number): string {
  return String(idx + 1).padStart(2, "0");
}

export default function ProcessLibraryClient() {
  const router = useRouter();
  const { authHeaders, token } = useAuth();
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(apiUrl("/processes/dashboard"), {
          headers: { ...authHeaders() },
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const body: DashboardPayload = await res.json();
        if (!cancelled) setData(body);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authHeaders, token]);

  const filtered = useMemo(() => {
    const all = data?.byTemplate ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((t) => t.name.toLowerCase().includes(needle));
  }, [data, q]);

  const summary = data?.summary;

  const cardOpen = (t: TemplateRow) => {
    const slug = t.slug || `template-${t.templateId}`;
    router.push(`/operations/boards/${slug}`);
  };

  return (
    <div data-pms className={styles.root}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <div className={`${styles.eyebrow} pms-cond`}>PRESTIGEDASH</div>
          <h1 className={`${styles.title} pms-cond`}>Processes</h1>
          <p className={styles.subtitle}>
            Every recurring operation at RPM Prestige lives here. Each process has its own board,
            stages, automation, and templates &mdash; so we run the same way every time.
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={`${styles.btn} ${styles.btnLight}`} type="button">
            <Download size={14} /> Import
          </button>
          <button className={`${styles.btn} ${styles.btnLight}`} type="button">
            <Copy size={14} /> Clone from library
          </button>
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            type="button"
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={14} /> New Process
          </button>
        </div>
      </header>

      <CreateProcessModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(template) => {
          // Match cardOpen()'s routing: prefer the new template's slug,
          // fall back to `template-${id}` for templates without a slug
          // (the backend POST doesn't auto-generate one yet).
          const slug = template.slug || `template-${template.id}`;
          router.push(`/operations/boards/${slug}`);
        }}
      />


      <section className={styles.statsGrid}>
        <BigStat label="Live processes" value={summary?.liveTemplates ?? "—"} sub="active templates" />
        <BigStat label="In-flight" value={summary?.inflight ?? "—"} sub="across portfolio" />
        <BigStat
          label="Overdue"
          value={summary?.overdue ?? "—"}
          tone="danger"
          sub={summary && summary.overdue > 0 ? "needs attention" : "all on track"}
        />
        <BigStat
          label="Completed (30d)"
          value={summary?.completed30d ?? "—"}
          tone="success"
          sub="last 30 days"
        />
        <BigStat
          label="Automation hit rate"
          value={
            summary?.automationHitRate != null
              ? `${Math.round(summary.automationHitRate * 100)}%`
              : "—"
          }
          tone="info"
          sub="coming with Autopilot"
        />
      </section>

      <div className={styles.searchRow}>
        <div className={styles.searchBox}>
          <Search size={15} color="var(--pms-ink-4)" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search processes…"
            type="search"
          />
        </div>
        <button className={`${styles.btn} ${styles.btnLightSm}`} type="button">
          <Filter size={13} /> All Types
        </button>
        <button className={`${styles.btn} ${styles.btnLightSm}`} type="button">
          <User size={13} /> All Owners
        </button>
        <button className={`${styles.btn} ${styles.btnLightSm}`} type="button">
          <Check size={13} /> Status
        </button>
        <div className={styles.flex1} />
        <div className={styles.viewToggle}>
          <button type="button" className={styles.viewToggleActive} title="Grid">
            <LayoutGrid size={14} />
          </button>
          <button type="button" title="List">
            <List size={14} />
          </button>
        </div>
      </div>

      {err && (
        <div className={styles.errorBanner}>
          Couldn&rsquo;t load process library: {err}
        </div>
      )}

      {loading && !data ? (
        <div className={styles.skeletonGrid}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={styles.skeletonCard} />
          ))}
        </div>
      ) : (
        <div className={styles.cardGrid}>
          {filtered.map((t, i) => (
            <ProcessCard
              key={t.templateId}
              template={t}
              code={formatCode(i)}
              onOpen={() => cardOpen(t)}
            />
          ))}
          {filtered.length === 0 && (
            <div className={styles.emptyState}>
              {q ? "No processes match that search." : "No active process templates yet."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BigStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: number | string;
  sub: string;
  tone?: "danger" | "success" | "info";
}) {
  const valueColor =
    tone === "danger"
      ? "var(--pms-danger)"
      : tone === "success"
      ? "var(--pms-ok)"
      : tone === "info"
      ? "var(--pms-info)"
      : "var(--pms-ink)";
  return (
    <div className={styles.bigStat}>
      <div className={styles.bigStatLabel}>{label}</div>
      <div className={`${styles.bigStatValue} pms-cond`} style={{ color: valueColor }}>
        {value}
      </div>
      <div className={styles.bigStatSub}>{sub}</div>
    </div>
  );
}

function ProcessCard({
  template,
  code,
  onOpen,
}: {
  template: TemplateRow;
  code: string;
  onOpen: () => void;
}) {
  const color = resolveColor(template.color, template.templateId);
  const Icon = resolveIcon(template.icon);
  return (
    <button type="button" onClick={onOpen} className={styles.processCard}>
      <div
        className={styles.cardHeader}
        style={{
          background: `linear-gradient(135deg, ${color} 0%, ${color} 70%, color-mix(in oklab, ${color} 70%, #000) 100%)`,
        }}
      >
        <svg className={styles.cardWatermark} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="0.75">
          <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
        </svg>
        <div className={styles.cardIconBox}>
          <Icon size={22} color="#fff" />
        </div>
        <div className={styles.cardHeaderText}>
          <div className={`${styles.cardCode} pms-cond`}>PROCESS {code}</div>
          <div className={`${styles.cardName} pms-cond`}>{template.name}</div>
        </div>
        <span className={styles.liveChip}>LIVE</span>
      </div>

      <div className={styles.cardStats}>
        <Stat n={template.activeCount} label="In flight" />
        <Stat
          n={template.overdueCount}
          label="Overdue"
          tone={template.overdueCount > 0 ? "danger" : undefined}
        />
        <Stat n={template.completed30d} label="Done (30d)" tone="success" />
      </div>

      <div className={styles.cardFooter}>
        <span className={styles.cardFooterText}>
          {template.avgDays != null ? `Avg ${template.avgDays}d to complete` : "—"}
        </span>
        <span className={styles.flex1} />
        <span className={styles.cardFooterText}>
          <Zap size={12} /> Autopilot coming soon
        </span>
      </div>
    </button>
  );
}

function Stat({
  n,
  label,
  tone,
}: {
  n: number;
  label: string;
  tone?: "danger" | "success";
}) {
  const c =
    tone === "danger" ? "var(--pms-danger)" : tone === "success" ? "var(--pms-ok)" : "var(--pms-ink-2)";
  return (
    <div className={styles.stat}>
      <div className={`${styles.statValue} pms-cond`} style={{ color: c }}>
        {n}
      </div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}
