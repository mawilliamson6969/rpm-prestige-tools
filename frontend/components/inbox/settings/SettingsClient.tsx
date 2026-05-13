"use client";

// Phase 8 — Settings screen at /inbox/settings.
//
// Sub-nav matches the design's SettingsView (screens.jsx lines 410–457):
// General · Inboxes · Team · Tags · Canned responses · Rules · Integrations.
// Rules links out to /inbox/rules (Phase 4); Integrations + General are
// placeholders for future work. The Inboxes panel pulls the legacy
// InboxSettingsClient content; Team wires to /users; Tags and Canned use
// the Phase 8 endpoints.

import { useMemo, useState } from "react";
import Link from "next/link";
import InboxSettingsClient from "../../../app/(protected)/inbox/settings/InboxSettingsClient";
import TagsPanel from "./TagsPanel";
import CannedResponsesPanel from "./CannedResponsesPanel";
import TeamPanel from "./TeamPanel";
import styles from "./settings.module.css";

type SectionId =
  | "general"
  | "inboxes"
  | "team"
  | "tags"
  | "canned"
  | "rules"
  | "integrations";

type SectionDef = {
  id: SectionId;
  label: string;
  glyph: string;
};

const SECTIONS: SectionDef[] = [
  { id: "general", label: "General", glyph: "⚙" },
  { id: "inboxes", label: "Inboxes", glyph: "✉" },
  { id: "team", label: "Team", glyph: "👥" },
  { id: "tags", label: "Tags", glyph: "🏷" },
  { id: "canned", label: "Canned responses", glyph: "⚡" },
  { id: "rules", label: "Rules", glyph: "🔄" },
  { id: "integrations", label: "Integrations", glyph: "🔌" },
];

export default function SettingsClient() {
  const [section, setSection] = useState<SectionId>("inboxes");

  const active = useMemo(
    () => SECTIONS.find((s) => s.id === section) ?? SECTIONS[1],
    [section]
  );

  return (
    <div className={styles.shell}>
      <nav className={styles.nav} aria-label="Settings sections">
        <div className={styles.navHd}>Settings</div>
        {SECTIONS.map((s) => {
          // Rules is a separate route (Phase 4) — render as a Link.
          if (s.id === "rules") {
            return (
              <Link
                key={s.id}
                href="/inbox/rules"
                className={styles.navItem}
                data-active="false"
              >
                <span className={styles.navItemGlyph} aria-hidden>
                  {s.glyph}
                </span>
                <span>{s.label}</span>
              </Link>
            );
          }
          return (
            <button
              key={s.id}
              type="button"
              className={styles.navItem}
              data-active={section === s.id ? "true" : "false"}
              onClick={() => setSection(s.id)}
            >
              <span className={styles.navItemGlyph} aria-hidden>
                {s.glyph}
              </span>
              <span>{s.label}</span>
            </button>
          );
        })}
      </nav>

      <div className={styles.content}>
        {section === "general" ? <GeneralPanel /> : null}
        {section === "inboxes" ? (
          // Phase 8: lift the legacy settings content as the Inboxes panel.
          <InboxSettingsClient />
        ) : null}
        {section === "team" ? <TeamPanel /> : null}
        {section === "tags" ? <TagsPanel /> : null}
        {section === "canned" ? <CannedResponsesPanel /> : null}
        {section === "integrations" ? <IntegrationsPanel /> : null}
        {/* `rules` is handled via Link above. */}
        {section === "rules" ? null : null}
      </div>
    </div>
  );

  // Suppress unused-variable warnings while we wire panels incrementally.
  void active;
}

function GeneralPanel() {
  return (
    <>
      <header className={styles.hd}>
        <div>
          <h1 className={styles.title}>General</h1>
          <p className={styles.sub}>
            Workspace-wide preferences for the shared inbox. The bulk of
            personal preferences (signature, density, status tabs) live
            inside the inbox itself.
          </p>
        </div>
      </header>
      <div className={styles.empty}>General settings will land in a later phase.</div>
    </>
  );
}

function IntegrationsPanel() {
  return (
    <>
      <header className={styles.hd}>
        <div>
          <h1 className={styles.title}>Integrations</h1>
          <p className={styles.sub}>
            Connect AppFolio, LeadSimple, RentEngine, Boom, and other
            external systems. Connection management lives outside the
            inbox today — manage from the workspace admin panel.
          </p>
        </div>
      </header>
      <div className={styles.empty}>Integrations panel coming in a later phase.</div>
    </>
  );
}
