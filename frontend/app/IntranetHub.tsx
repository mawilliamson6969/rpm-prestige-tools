"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AgentsHubCard from "../components/AgentsHubCard";
import WikiHubCard from "../components/WikiHubCard";
import PlaybookHubCard from "../components/PlaybookHubCard";
import FileManagerHubCard from "../components/FileManagerHubCard";
import SharedInboxHubCard from "../components/SharedInboxHubCard";
import VideoMessagesHubCard from "../components/VideoMessagesHubCard";
import AddAnnouncementModal from "./AddAnnouncementModal";
import WidgetLibraryPanel from "../components/widgets/WidgetLibraryPanel";
import { renderWidget } from "../components/widgets/Widgets";
import { useAuth } from "../context/AuthContext";
import { apiUrl } from "../lib/api";
import { useLayoutPrefs } from "../hooks/useLayoutPrefs";
import {
  DEFAULT_HUB_CARDS,
  DEFAULT_HUB_LAYOUT,
  type CardSize,
  type HubCardDef,
  type HubCardLayout,
  type HubWidgetLayout,
  type WidgetDef,
} from "../lib/layoutPrefs";
import styles from "./intranet-hub.module.css";

const DOOR_GOAL = 300;

const QUICK_LINKS = [
  { label: "AppFolio", href: "https://rpmtx033.appfolio.com", icon: "🏠" },
  { label: "LeadSimple", href: "https://app.leadsimple.com", icon: "📋" },
  { label: "Blanket", href: "https://rpmprestige.blankethomes.com/pm", icon: "🔧" },
  { label: "RentEngine", href: "https://app.rentengine.io/owner/default", icon: "📊" },
  { label: "Second Nature", href: "https://www.secondnature.com", icon: "🏡" },
  { label: "BoomScreen", href: "https://www.boompay.app/", icon: "🔍" },
] as const;

const TEAM = [
  { name: "Mike Williamson", role: "Owner/Operator", initials: "MW", color: "#0098D0" },
  { name: "Lori", role: "Client Success Manager", initials: "Lo", color: "#B32317" },
  { name: "Leslie", role: "Business Development / Leasing", initials: "Le", color: "#1B2856" },
  { name: "Amanda", role: "Maintenance Coordinator", initials: "AM", color: "#2E7D6B" },
] as const;

const USEFUL_LINKS = [
  { label: "Texas Property Code Ch. 92", href: "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.92.htm" },
  { label: "TREC Website", href: "https://www.trec.texas.gov" },
  { label: "HAR MLS", href: "https://www.har.com" },
  { label: "RPM Prestige Website", href: "https://www.prestigerpm.com/" },
  { label: "RPM Intranet", href: "https://rpmintranet.com/login" },
] as const;

function occupancyApiUrl() {
  const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";
  if (base) return `${base}/dashboard/occupancy`;
  return "/api/dashboard/occupancy";
}

function announcementsApiUrl() {
  const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";
  if (base) return `${base}/announcements`;
  return "/api/announcements";
}

type OccupancyData = {
  totalUnitCount: number;
  occupancyRatePercent: number;
  vacantCount: number;
  onNoticeUnits?: number;
  refreshedAt?: string;
};

function vacantCountColor(n: number) {
  if (n < 5) return "#1a7f4c";
  if (n <= 10) return "#c5960c";
  return "#b32317";
}

type AnnouncementRow = {
  id: string;
  title: string;
  content: string;
  created_at: string;
  attachment_url?: string | null;
  attachment_label?: string | null;
  status?: string;
};

function attachmentHref(url: string) {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return apiUrl(url);
}

function sizeClassFor(size: CardSize) {
  if (size === "small") return styles.hubGridItemSmall;
  if (size === "large") return styles.hubGridItemLarge;
  return styles.hubGridItemMedium;
}

type ToolCardLiveInnerProps = {
  title: string;
  description: string;
  icon?: string;
};

function ToolCardInner({ title, description, icon }: ToolCardLiveInnerProps) {
  return (
    <>
      <div className={styles.toolCardHeader}>
        <h3 className={styles.toolCardTitle}>
          {icon ? (
            <span aria-hidden style={{ marginRight: "0.35rem" }}>
              {icon}
            </span>
          ) : null}
          {title}
        </h3>
        <span className={`${styles.badge} ${styles.badgeLive}`}>Live</span>
      </div>
      <p className={styles.toolCardDesc}>{description}</p>
    </>
  );
}

function ToolCardLive({
  href,
  title,
  description,
  external,
  icon,
  interactive = true,
}: {
  href: string;
  title: string;
  description: string;
  external?: boolean;
  icon?: string;
  interactive?: boolean;
}) {
  const inner = <ToolCardInner title={title} description={description} icon={icon} />;
  if (!interactive) {
    return <div className={`${styles.toolCard} ${styles.toolCardLive}`}>{inner}</div>;
  }
  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`${styles.toolCard} ${styles.toolCardLive}`}
      >
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className={`${styles.toolCard} ${styles.toolCardLive}`}>
      {inner}
    </Link>
  );
}

function renderHubCardContent(def: HubCardDef, interactive: boolean) {
  if (!interactive) {
    return (
      <div className={`${styles.toolCard} ${styles.toolCardLive}`}>
        <ToolCardInner title={def.title} description={def.description} icon={def.icon} />
      </div>
    );
  }
  switch (def.component) {
    case "agents":
      return <AgentsHubCard />;
    case "wiki":
      return <WikiHubCard />;
    case "playbook":
      return <PlaybookHubCard />;
    case "files":
      return <FileManagerHubCard />;
    case "inbox":
      return <SharedInboxHubCard />;
    case "videos":
      return <VideoMessagesHubCard />;
    default:
      return (
        <ToolCardLive
          href={def.href || "/"}
          title={def.title}
          description={def.description}
          external={def.external}
          icon={def.icon}
        />
      );
  }
}

export default function IntranetHub() {
  const { authHeaders, isAdmin, token } = useAuth();
  const { prefs, loaded, saveNow, update, reset } = useLayoutPrefs();
  const [occupancy, setOccupancy] = useState<OccupancyData | null>(null);
  const [occLoading, setOccLoading] = useState(true);
  const [occError, setOccError] = useState<string | null>(null);
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const loadAnnouncements = useCallback(async () => {
    try {
      const res = await fetch(announcementsApiUrl(), {
        cache: "no-store",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(body.announcements)) {
        setAnnouncements(body.announcements);
      }
    } catch {
      setAnnouncements([]);
    }
  }, [authHeaders]);

  const loadOccupancy = useCallback(async () => {
    setOccLoading(true);
    setOccError(null);
    try {
      const res = await fetch(occupancyApiUrl(), {
        cache: "no-store",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : `Request failed (${res.status}).`);
      }
      setOccupancy(body);
    } catch (e) {
      setOccupancy(null);
      setOccError(e instanceof Error ? e.message : "Could not load KPI data.");
    } finally {
      setOccLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    if (!token) return;
    loadOccupancy();
  }, [loadOccupancy, token]);

  useEffect(() => {
    if (!token) return;
    loadAnnouncements();
  }, [loadAnnouncements, token]);

  /* =========== Hub layout management =========== */

  const hubCardsDefMap = useMemo(() => {
    const map = new Map<string, HubCardDef>();
    for (const c of DEFAULT_HUB_CARDS) map.set(c.id, c);
    return map;
  }, []);

  const hubLayoutForRender = useMemo<HubCardLayout[]>(() => {
    const saved = prefs.hubLayout.length > 0 ? prefs.hubLayout : DEFAULT_HUB_LAYOUT;
    return saved
      .filter((l) => {
        const def = hubCardsDefMap.get(l.cardId);
        if (!def) return false;
        if (def.adminOnly && !isAdmin) return false;
        return true;
      })
      .slice()
      .sort((a, b) => a.order - b.order);
  }, [prefs.hubLayout, hubCardsDefMap, isAdmin]);

  const visibleCards = useMemo(
    () => hubLayoutForRender.filter((l) => l.visible || editMode),
    [hubLayoutForRender, editMode]
  );

  const visibleWidgets = useMemo(
    () =>
      prefs.hubWidgets
        .filter((w) => w.visible || editMode)
        .slice()
        .sort((a, b) => a.order - b.order),
    [prefs.hubWidgets, editMode]
  );

  const updateCardSize = useCallback(
    (cardId: string, size: CardSize) => {
      update(
        (p) => ({
          ...p,
          hubLayout: (p.hubLayout.length > 0 ? p.hubLayout : DEFAULT_HUB_LAYOUT).map((l) =>
            l.cardId === cardId ? { ...l, size } : l
          ),
        }),
        0
      );
    },
    [update]
  );

  const hideCard = useCallback(
    (cardId: string) => {
      update(
        (p) => ({
          ...p,
          hubLayout: (p.hubLayout.length > 0 ? p.hubLayout : DEFAULT_HUB_LAYOUT).map((l) =>
            l.cardId === cardId ? { ...l, visible: false } : l
          ),
        }),
        0
      );
    },
    [update]
  );

  const addCardFromLibrary = useCallback(
    (def: HubCardDef) => {
      update(
        (p) => {
          const base = p.hubLayout.length > 0 ? p.hubLayout : DEFAULT_HUB_LAYOUT;
          const exists = base.find((l) => l.cardId === def.id);
          const maxOrder = base.reduce((acc, l) => Math.max(acc, l.order), -1);
          const nextHubLayout = exists
            ? base.map((l) =>
                l.cardId === def.id ? { ...l, visible: true, order: maxOrder + 1 } : l
              )
            : [
                ...base,
                {
                  cardId: def.id,
                  visible: true,
                  order: maxOrder + 1,
                  size: "medium" as CardSize,
                  section: def.section,
                },
              ];
          return { ...p, hubLayout: nextHubLayout };
        },
        0
      );
    },
    [update]
  );

  const addWidgetFromLibrary = useCallback(
    (def: WidgetDef) => {
      update(
        (p) => {
          const exists = p.hubWidgets.find((w) => w.widgetId === def.id);
          const maxOrder = p.hubWidgets.reduce((acc, w) => Math.max(acc, w.order), -1);
          const next = exists
            ? p.hubWidgets.map((w) =>
                w.widgetId === def.id ? { ...w, visible: true, order: maxOrder + 1 } : w
              )
            : [
                ...p.hubWidgets,
                {
                  widgetId: def.id,
                  visible: true,
                  order: maxOrder + 1,
                  size: def.defaultSize,
                  config: def.defaultConfig,
                },
              ];
          return { ...p, hubWidgets: next };
        },
        0
      );
    },
    [update]
  );

  const hideWidget = useCallback(
    (widgetId: string) => {
      update(
        (p) => ({
          ...p,
          hubWidgets: p.hubWidgets.map((w) =>
            w.widgetId === widgetId ? { ...w, visible: false } : w
          ),
        }),
        0
      );
    },
    [update]
  );

  const updateWidgetSize = useCallback(
    (widgetId: string, size: CardSize) => {
      update(
        (p) => ({
          ...p,
          hubWidgets: p.hubWidgets.map((w) => (w.widgetId === widgetId ? { ...w, size } : w)),
        }),
        0
      );
    },
    [update]
  );

  const updateWidgetConfig = useCallback(
    (widgetId: string, config: Record<string, unknown>) => {
      update(
        (p) => ({
          ...p,
          hubWidgets: p.hubWidgets.map((w) =>
            w.widgetId === widgetId ? { ...w, config } : w
          ),
        }),
        0
      );
    },
    [update]
  );

  /* =========== Drag and drop =========== */

  const moveItem = useCallback(
    (kind: "card" | "widget", fromId: string, toId: string) => {
      if (fromId === toId) return;
      update(
        (p) => {
          if (kind === "card") {
            const base =
              p.hubLayout.length > 0 ? [...p.hubLayout] : [...DEFAULT_HUB_LAYOUT];
            const sorted = base.slice().sort((a, b) => a.order - b.order);
            const fromIdx = sorted.findIndex((l) => l.cardId === fromId);
            const toIdx = sorted.findIndex((l) => l.cardId === toId);
            if (fromIdx < 0 || toIdx < 0) return p;
            const [moved] = sorted.splice(fromIdx, 1);
            sorted.splice(toIdx, 0, moved);
            return {
              ...p,
              hubLayout: sorted.map((l, i) => ({ ...l, order: i })),
            };
          }
          const sorted = [...p.hubWidgets].sort((a, b) => a.order - b.order);
          const fromIdx = sorted.findIndex((w) => w.widgetId === fromId);
          const toIdx = sorted.findIndex((w) => w.widgetId === toId);
          if (fromIdx < 0 || toIdx < 0) return p;
          const [moved] = sorted.splice(fromIdx, 1);
          sorted.splice(toIdx, 0, moved);
          return {
            ...p,
            hubWidgets: sorted.map((w, i) => ({ ...w, order: i })),
          };
        },
        0
      );
    },
    [update]
  );

  const handleCardDragStart = (cardId: string) => (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", `card:${cardId}`);
    setDraggingId(`card:${cardId}`);
  };

  const handleWidgetDragStart = (widgetId: string) => (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", `widget:${widgetId}`);
    setDraggingId(`widget:${widgetId}`);
  };

  const handleDragOver = (targetKind: "card" | "widget", targetId: string) =>
    (e: React.DragEvent) => {
      const data = e.dataTransfer.types.includes("text/plain") ? draggingId : null;
      if (!data) return;
      if (!data.startsWith(`${targetKind}:`)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDropTargetId(`${targetKind}:${targetId}`);
    };

  const handleDrop = (targetKind: "card" | "widget", targetId: string) =>
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData("text/plain");
      setDropTargetId(null);
      setDraggingId(null);
      if (!raw) return;
      const [kind, fromId] = raw.split(":");
      if (kind !== targetKind) return;
      moveItem(targetKind, fromId, targetId);
    };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDropTargetId(null);
  };

  /* =========== Handlers =========== */

  const doneEditing = async () => {
    await saveNow(prefs);
    setEditMode(false);
    setLibraryOpen(false);
  };

  const onReset = async () => {
    if (
      !window.confirm(
        "Reset hub layout to defaults? This will restore the original card order and remove any widgets."
      )
    )
      return;
    await reset();
  };

  /* =========== Render =========== */

  if (!loaded) {
    return (
      <div className={styles.page}>
        <header className={styles.headerBar}>
          <div>
            <h1 className={styles.brandTitle}>Real Property Management Prestige</h1>
            <p className={styles.brandSub}>Team Hub — Internal Use Only</p>
          </div>
        </header>
        <div className={styles.main}>
          <div className={styles.skeletonRow}>
            <div className={styles.skeletonCard} />
            <div className={styles.skeletonCard} />
            <div className={styles.skeletonCard} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.headerBar} style={{ position: "relative" }}>
        <div>
          <h1 className={styles.brandTitle}>Real Property Management Prestige</h1>
          <p className={styles.brandSub}>Team Hub — Internal Use Only</p>
        </div>
        {!editMode ? (
          <button
            type="button"
            className={styles.editLayoutBtn}
            onClick={() => setEditMode(true)}
            aria-label="Edit layout"
          >
            ✏️ Edit Layout
          </button>
        ) : null}
      </header>

      {editMode ? (
        <div className={styles.editToolbar}>
          <span className={styles.editToolbarLabel}>Editing Layout</span>
          <div className={styles.editToolbarSpacer} />
          <button
            type="button"
            className={styles.editToolbarBtn}
            onClick={() => setLibraryOpen(true)}
          >
            + Add Widget
          </button>
          <button type="button" className={styles.editToolbarBtn} onClick={onReset}>
            Reset to Default
          </button>
          <button
            type="button"
            className={`${styles.editToolbarBtn} ${styles.editToolbarBtnPrimary}`}
            onClick={doneEditing}
          >
            Done
          </button>
        </div>
      ) : null}

      <nav className={styles.quickLinks} aria-label="Quick links to core systems">
        <div className={styles.quickLinksInner}>
          {QUICK_LINKS.map((q) => (
            <a
              key={q.href}
              href={q.href}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.quickCard}
            >
              <span className={styles.quickIcon} aria-hidden>
                {q.icon}
              </span>
              {q.label}
            </a>
          ))}
        </div>
      </nav>

      <div className={styles.main}>
        <div className={styles.grid}>
          <div className={editMode ? styles.editModeContainer : undefined}>
            <section aria-labelledby="kpis-heading">
              <h2 id="kpis-heading" className={styles.sectionTitle}>
                Quick KPIs
              </h2>
              {occLoading && !occupancy && (
                <div className={styles.skeletonRow} aria-hidden>
                  <div className={styles.skeletonCard} />
                  <div className={styles.skeletonCard} />
                  <div className={styles.skeletonCard} />
                </div>
              )}
              {occError && <div className={styles.kpiError}>{occError}</div>}
              {occupancy && (
                <div className={styles.kpiRow}>
                  <div className={styles.kpiCard}>
                    <div className={styles.kpiLabel}>Total doors</div>
                    <div className={styles.kpiValue}>{occupancy.totalUnitCount}</div>
                    <div className={styles.kpiHint}>Goal: {DOOR_GOAL} units</div>
                  </div>
                  <div className={styles.kpiCard}>
                    <div className={styles.kpiLabel}>Occupancy</div>
                    <div className={styles.kpiValue}>{occupancy.occupancyRatePercent}%</div>
                    <div className={styles.kpiHint}>Rent roll · cached</div>
                    {(occupancy.onNoticeUnits ?? 0) > 0 ? (
                      <div className={styles.kpiHint} style={{ marginTop: "0.35rem", fontWeight: 600 }}>
                        {occupancy.onNoticeUnits} on notice
                      </div>
                    ) : null}
                  </div>
                  <div className={styles.kpiCard}>
                    <div className={styles.kpiLabel}>Vacant units</div>
                    <div
                      className={styles.kpiValue}
                      style={{ color: vacantCountColor(occupancy.vacantCount) }}
                    >
                      {occupancy.vacantCount}
                    </div>
                    <div className={styles.kpiHint}>Across portfolio</div>
                  </div>
                </div>
              )}
              <Link href="/dashboard" className={styles.dashboardLink}>
                View Full Dashboard →
              </Link>
            </section>

            {visibleWidgets.length > 0 ? (
              <section aria-label="Widgets" style={{ marginTop: "2rem" }}>
                <h2 className={styles.sectionTitle}>Your Widgets</h2>
                <div className={styles.hubGrid}>
                  {visibleWidgets.map((w) => {
                    const widgetDragId = `widget:${w.widgetId}`;
                    return (
                      <div
                        key={w.widgetId}
                        className={`${sizeClassFor(w.size)} ${styles.hubCardWrap}`}
                        data-edit={editMode ? "true" : "false"}
                        data-dragging={draggingId === widgetDragId ? "true" : "false"}
                        data-drop-target={dropTargetId === widgetDragId ? "true" : "false"}
                      >
                        {renderWidget(w, {
                          editMode,
                          onHide: () => hideWidget(w.widgetId),
                          onSizeChange: (s) => updateWidgetSize(w.widgetId, s),
                          onConfigChange: (c) => updateWidgetConfig(w.widgetId, c),
                          onDragStart: handleWidgetDragStart(w.widgetId),
                          onDragOver: handleDragOver("widget", w.widgetId),
                          onDrop: handleDrop("widget", w.widgetId),
                          onDragEnd: handleDragEnd,
                        })}
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <section className={styles.toolCategory} aria-labelledby="tools-heading">
              <h2 id="tools-heading" className={styles.sectionTitle}>
                Our Tools
              </h2>

              <div className={styles.hubGrid}>
                {visibleCards.map((l) => {
                  const def = hubCardsDefMap.get(l.cardId);
                  if (!def) return null;
                  const cardDragId = `card:${def.id}`;
                  return (
                    <div
                      key={def.id}
                      className={`${sizeClassFor(l.size)} ${styles.hubCardWrap}`}
                      data-edit={editMode ? "true" : "false"}
                      data-dragging={draggingId === cardDragId ? "true" : "false"}
                      data-drop-target={dropTargetId === cardDragId ? "true" : "false"}
                      draggable={editMode}
                      onDragStart={handleCardDragStart(def.id)}
                      onDragOver={handleDragOver("card", def.id)}
                      onDrop={handleDrop("card", def.id)}
                      onDragEnd={handleDragEnd}
                      style={editMode && !l.visible ? { opacity: 0.4 } : undefined}
                    >
                      {editMode ? (
                        <>
                          <span className={styles.hubCardDragHandle} aria-label="Drag to reorder">
                            ⋮⋮
                          </span>
                          <div className={styles.hubCardEditBar}>
                            {(["small", "medium", "large"] as CardSize[]).map((s) => (
                              <button
                                key={s}
                                type="button"
                                className={`${styles.hubCardEditBtn} ${
                                  l.size === s ? styles.hubCardEditBtnActive : ""
                                }`}
                                onClick={() => updateCardSize(def.id, s)}
                                title={`Size: ${s}`}
                              >
                                {s === "small" ? "S" : s === "medium" ? "M" : "L"}
                              </button>
                            ))}
                            <button
                              type="button"
                              className={styles.hubCardEditBtn}
                              onClick={() => hideCard(def.id)}
                              title="Hide"
                              aria-label="Hide card"
                            >
                              ✕
                            </button>
                          </div>
                        </>
                      ) : null}
                      {renderHubCardContent(def, !editMode)}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          <aside>
            <section className={styles.sidebarSection} aria-labelledby="announce-heading">
              <div className={styles.announceHeader}>
                <h2 id="announce-heading" className={styles.sectionTitle}>
                  Team Announcements
                </h2>
                {isAdmin ? (
                  <button type="button" className={styles.addAnnounceBtn} onClick={() => setAddOpen(true)}>
                    + Add
                  </button>
                ) : null}
              </div>
              {announcements.length === 0 ? (
                <p className={styles.kpiHint}>No announcements yet.</p>
              ) : (
                <ul className={styles.announceList}>
                  {announcements.map((a) => (
                    <li key={a.id} className={styles.announceItem}>
                      <strong>{a.title}</strong> — {a.content}
                      {a.attachment_url ? (
                        <div className={styles.announceAttach}>
                          <a
                            href={attachmentHref(a.attachment_url)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {a.attachment_label?.trim() || "View attachment"}
                          </a>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/announcements" className={styles.dashboardLink} style={{ marginTop: "0.65rem", display: "inline-block" }}>
                See All Announcements →
              </Link>
            </section>

            <section className={styles.sidebarSection} aria-labelledby="directory-heading">
              <h2 id="directory-heading" className={styles.sectionTitle}>
                Team Directory
              </h2>
              <div className={styles.directoryGrid}>
                {TEAM.map((m) => (
                  <div key={m.name} className={styles.dirCard}>
                    <div className={styles.avatar} style={{ background: m.color }}>
                      {m.initials}
                    </div>
                    <div>
                      <p className={styles.dirName}>{m.name}</p>
                      <p className={styles.dirRole}>{m.role}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className={styles.sidebarSection} aria-labelledby="useful-heading">
              <h2 id="useful-heading" className={styles.sectionTitle}>
                Useful Links
              </h2>
              <ul className={styles.usefulList}>
                {USEFUL_LINKS.map((u) => (
                  <li key={u.href}>
                    <a href={u.href} target="_blank" rel="noopener noreferrer">
                      {u.label}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      </div>

      <AddAnnouncementModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={() => loadAnnouncements()}
      />

      <WidgetLibraryPanel
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        hubLayout={hubLayoutForRender}
        hubWidgets={prefs.hubWidgets}
        isAdmin={isAdmin}
        onAddCard={(c) => {
          addCardFromLibrary(c);
        }}
        onAddWidget={(w) => {
          addWidgetFromLibrary(w);
        }}
      />

      <footer className={styles.footer}>
        <p>© 2026 Real Property Management Prestige — A Neighborly® Company</p>
        <p>Houston, TX</p>
        <p className={styles.footerAdmin}>
          <Link href="/admin/forms">Admin</Link>
        </p>
      </footer>
    </div>
  );
}
