"use client";

import Link from "next/link";
import { GitBranch, Zap, Mail, MessageSquare, Hash, Settings, type LucideIcon } from "lucide-react";
import styles from "./tab-strip.module.css";
import type { ProcessTab } from "./ProcessTabStrip";

const TAB_META: Record<
  Exclude<ProcessTab, "board">,
  { title: string; phase: string; icon: LucideIcon; body: string }
> = {
  stages: {
    title: "Stages & Workflows",
    phase: "Lands in Phase 7.1",
    icon: GitBranch,
    body:
      "The visual stage editor and workflow timeline — drag-reorder stages, configure task kinds (todo / email / text / call / meet / stage-change / branch), set when-and-day rules, and reference email/text templates. Replaces the legacy Templates editor.",
  },
  autopilot: {
    title: "Autopilot Rules",
    phase: "Lands in Phase 7.4",
    icon: Zap,
    body:
      "Rules that start a new process automatically whenever a record matches their conditions — e.g., start a Periodic Inspection 125 days in advance for every active unit. Requires the step-execution engine, so it ships after templates + custom fields.",
  },
  email: {
    title: "Email Templates",
    phase: "Lands in Phase 7.1",
    icon: Mail,
    body:
      "Per-process email templates with {{variable}} substitution. Referenced by workflow steps so an automated email can pick the right template. Includes sends / opens / clicks counters.",
  },
  text: {
    title: "Text Templates",
    phase: "Lands in Phase 7.1",
    icon: MessageSquare,
    body:
      "Short SMS templates used by text-kind workflow steps. Same {{variable}} substitution as emails.",
  },
  fields: {
    title: "Custom Fields",
    phase: "Lands in Phase 7.3",
    icon: Hash,
    body:
      "Add custom fields at three scopes — Processes (per-instance), Properties (on the property record), and Contacts. Field values are referenceable in email/text templates and conditional logic.",
  },
  settings: {
    title: "General Settings",
    phase: "Lands in Phase 7.5",
    icon: Settings,
    body:
      "Process owner, SLA defaults, default starting stage, version history, and per-template permissions.",
  },
};

export default function TabStubContent({
  slug,
  tab,
}: {
  slug: string;
  tab: Exclude<ProcessTab, "board">;
}) {
  const meta = TAB_META[tab];
  const Icon = meta.icon;
  return (
    <div data-pms className={styles.stubWrap}>
      <div className={styles.stubCard}>
        <div className={styles.stubIcon}>
          <Icon size={24} />
        </div>
        <h2 className={`${styles.stubTitle} pms-cond`}>{meta.title}</h2>
        <p className={styles.stubBody}>{meta.body}</p>
        <span className={styles.stubPhase}>{meta.phase}</span>
        <div>
          <Link href={`/operations/boards/${slug}`} className={styles.stubBackLink}>
            ← Back to board
          </Link>
        </div>
      </div>
    </div>
  );
}
