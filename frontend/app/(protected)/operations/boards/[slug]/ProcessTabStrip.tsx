"use client";

import Link from "next/link";
import {
  LayoutGrid,
  GitBranch,
  Zap,
  Mail,
  MessageSquare,
  Hash,
  Settings,
  type LucideIcon,
} from "lucide-react";
import styles from "./tab-strip.module.css";

export type ProcessTab = "board" | "stages" | "autopilot" | "email" | "text" | "fields" | "settings";

const TABS: Array<{ id: ProcessTab; label: string; icon: LucideIcon }> = [
  { id: "board",     label: "Board",              icon: LayoutGrid },
  { id: "stages",    label: "Stages & Workflows", icon: GitBranch },
  { id: "autopilot", label: "Autopilot Rules",    icon: Zap },
  { id: "email",     label: "Email Templates",    icon: Mail },
  { id: "text",      label: "Text Templates",     icon: MessageSquare },
  { id: "fields",    label: "Custom Fields",      icon: Hash },
  { id: "settings",  label: "Settings",           icon: Settings },
];

/**
 * Phase 7.0.1: the per-process tab strip that sits beneath the
 * Operations top bar and above the active tab content. Only the Board
 * tab is wired today; the other six route to a stub explaining the
 * phase they'll land in. The strip stays sticky so it never scrolls
 * off-screen as you work down a long board.
 */
export default function ProcessTabStrip({
  slug,
  active,
}: {
  slug: string;
  active: ProcessTab;
}) {
  return (
    <div data-pms className={styles.strip}>
      <nav className={styles.scroll}>
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = active === t.id;
          const href = t.id === "board" ? `/operations/boards/${slug}` : `/operations/boards/${slug}?tab=${t.id}`;
          return (
            <Link
              key={t.id}
              href={href}
              className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
              prefetch={false}
            >
              <Icon size={14} />
              <span>{t.label}</span>
              {isActive && <span className={styles.underline} />}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
