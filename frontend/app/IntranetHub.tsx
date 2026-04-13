"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import InboxNavLink from "../components/InboxNavLink";
import MarketingNavDropdown from "../components/MarketingNavDropdown";
import WikiHubCard from "../components/WikiHubCard";
import FileManagerHubCard from "../components/FileManagerHubCard";
import SharedInboxHubCard from "../components/SharedInboxHubCard";
import VideoMessagesHubCard from "../components/VideoMessagesHubCard";
import UserMenu from "../components/UserMenu";
import AddAnnouncementModal from "./AddAnnouncementModal";
import { useAuth } from "../context/AuthContext";
import { apiUrl } from "../lib/api";
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

const TEASERS = [
  {
    title: "AI Chatbot",
    desc: "AppFolio-connected chatbot for tenants and owners",
  },
  {
    title: "Scheduling",
    desc: "Calendly replacement for owner consultations",
  },
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

function ToolCardLive({
  href,
  title,
  description,
  external,
}: {
  href: string;
  title: string;
  description: string;
  external?: boolean;
}) {
  const inner = (
    <>
      <div className={styles.toolCardHeader}>
        <h3 className={styles.toolCardTitle}>{title}</h3>
        <span className={`${styles.badge} ${styles.badgeLive}`}>Live</span>
      </div>
      <p className={styles.toolCardDesc}>{description}</p>
    </>
  );
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

function ToolCardSoon({ title, description }: { title: string; description: string }) {
  return (
    <div className={`${styles.toolCard} ${styles.toolCardMuted}`} aria-disabled="true">
      <div className={styles.toolCardHeader}>
        <h3 className={styles.toolCardTitle}>{title}</h3>
        <span className={`${styles.badge} ${styles.badgeSoon}`}>Coming Soon</span>
      </div>
      <p className={styles.toolCardDesc}>{description}</p>
    </div>
  );
}

export default function IntranetHub() {
  const { authHeaders, isAdmin, token } = useAuth();
  const [now, setNow] = useState(() => new Date());
  const [occupancy, setOccupancy] = useState<OccupancyData | null>(null);
  const [occLoading, setOccLoading] = useState(true);
  const [occError, setOccError] = useState<string | null>(null);
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([]);
  const [addOpen, setAddOpen] = useState(false);

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

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

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
        const msg =
          typeof body.error === "string"
            ? body.error
            : `Request failed (${res.status}).`;
        throw new Error(msg);
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

  const clockStr = now.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div className={styles.page}>
      <header className={styles.headerBar}>
        <div>
          <h1 className={styles.brandTitle}>Real Property Management Prestige</h1>
          <p className={styles.brandSub}>Team Hub — Internal Use Only</p>
        </div>
        <div className={styles.headerAside}>
          <div className={styles.clock}>
            <span className={styles.clockLabel}>Houston (CT)</span>
            <span>{clockStr}</span>
          </div>
          <Link href="/wiki" className={styles.headerWikiLink}>
            Wiki
          </Link>
          <Link href="/files" className={styles.headerWikiLink}>
            Files
          </Link>
          <MarketingNavDropdown variant="hub" />
          <InboxNavLink />
          <UserMenu />
        </div>
      </header>

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
          <div>
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

            <section className={styles.toolCategory} aria-labelledby="tools-heading">
              <h2 id="tools-heading" className={styles.sectionTitle}>
                Our Tools
              </h2>

              <p className={styles.catLabel}>Dashboards</p>
              <div className={styles.toolGrid}>
                <ToolCardLive
                  href="/dashboard"
                  title="KPI Dashboard"
                  description="Live AppFolio data: doors, occupancy, property breakdown"
                />
              </div>

              <p className={styles.catLabel}>AI Tools</p>
              <div className={styles.toolGrid}>
                <ToolCardLive
                  href="/ask"
                  title="Ask the AI"
                  description="Ask any question about your properties, tenants, work orders, or finances and get instant answers"
                />
              </div>

              <p className={styles.catLabel}>Knowledge Base</p>
              <div className={styles.toolGrid}>
                <WikiHubCard />
              </div>

              <p className={styles.catLabel}>Tools</p>
              <div className={styles.toolGrid}>
                <FileManagerHubCard />
              </div>

              <p className={styles.catLabel}>Communications</p>
              <div className={styles.toolGrid}>
                <SharedInboxHubCard />
                <VideoMessagesHubCard />
              </div>

              <p className={styles.catLabel}>Marketing</p>
              <div className={styles.toolGrid}>
                <ToolCardLive
                  href="/marketing/calendar"
                  title="Content Calendar"
                  description="Plan and schedule content across all channels"
                />
                <ToolCardSoon title="Lead Magnets" description="Downloadable guides and capture assets" />
                <ToolCardSoon title="Email Newsletters" description="Design, send, and track internal campaigns" />
                <ToolCardSoon title="Marketing Dashboard" description="Channel performance and ROI in one view" />
              </div>

              <p className={styles.catLabel}>EOS</p>
              <div className={styles.toolGrid}>
                <ToolCardLive
                  href="/eos/scorecard"
                  title="Scorecard"
                  description="Track weekly and monthly measurables"
                />
                <ToolCardLive
                  href="/eos/rocks"
                  title="Rocks"
                  description="Quarterly Rock tracking with milestones"
                />
                <ToolCardLive
                  href="/eos/l10"
                  title="L10 Meeting"
                  description="Run structured L10 meetings"
                />
              </div>

              <p className={styles.catLabel}>Forms</p>
              <div className={styles.toolGrid}>
                <ToolCardLive
                  href="/owner-termination"
                  title="Owner Termination Request"
                  description="Process owner requests to terminate management"
                />
                <ToolCardSoon
                  title="Maintenance Request"
                  description="Tenant maintenance issue submission"
                />
                <ToolCardSoon title="Owner Onboarding" description="New owner intake and property setup" />
                <ToolCardSoon title="Vendor Registration" description="New vendor intake and documentation" />
                <ToolCardSoon title="Tenant Pre-Screening" description="Pre-qualification for prospective tenants" />
                <ToolCardSoon title="Move-Out Inspection" description="Document property condition at move-out" />
                <ToolCardSoon title="Mileage Log" description="Log business mileage for reimbursement" />
              </div>

              <p className={styles.catLabel}>Admin</p>
              <div className={styles.toolGrid}>
                <ToolCardLive
                  href="/admin/forms"
                  title="Form Submissions"
                  description="Review and manage submitted forms across the organization"
                />
                {isAdmin ? (
                  <ToolCardLive
                    href="/admin/users"
                    title="User Management"
                    description="Add and edit team accounts and roles"
                  />
                ) : null}
              </div>

              <p className={styles.catLabel}>Coming Soon</p>
              <div className={styles.teaserGrid}>
                {TEASERS.map((t) => (
                  <div key={t.title} className={styles.teaserCard}>
                    <div className={styles.toolCardHeader} style={{ marginBottom: 0 }}>
                      <h3 className={styles.teaserTitle}>{t.title}</h3>
                      <span className={`${styles.badge} ${styles.badgeDev}`}>In Development</span>
                    </div>
                    <p className={styles.teaserDesc}>{t.desc}</p>
                  </div>
                ))}
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
