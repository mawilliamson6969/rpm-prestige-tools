"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AgentsNavLink from "../../../components/AgentsNavLink";
import InboxNavLink from "../../../components/InboxNavLink";
import UserMenu from "../../../components/UserMenu";
import EosNavDropdown from "../../../components/EosNavDropdown";
import styles from "./eos.module.css";

const LINKS = [
  { href: "/eos/scorecard", label: "Scorecard" },
  { href: "/eos/rocks", label: "Rocks" },
  { href: "/eos/l10", label: "L10" },
] as const;

export default function EosHeader() {
  const path = usePathname();
  return (
    <header className={styles.topBar}>
      <div className={styles.titleRow}>
        <Link href="/" className={styles.backLink}>
          ← Team Hub
        </Link>
        <EosNavDropdown variant="light" />
        <h1>EOS — Entrepreneurial Operating System</h1>
      </div>
      <nav className={styles.navLinks} aria-label="EOS sections">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={path === l.href || path.startsWith(`${l.href}/`) ? styles.navActive : undefined}
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <Link href="/wiki" className={styles.headerWikiLink}>
        Wiki
      </Link>
      <Link href="/files" className={styles.headerWikiLink}>
        Files
      </Link>
      <AgentsNavLink />
      <InboxNavLink />
      <UserMenu />
    </header>
  );
}
