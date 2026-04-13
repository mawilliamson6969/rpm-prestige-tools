"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import EosNavDropdown from "./EosNavDropdown";
import MarketingNavDropdown from "./MarketingNavDropdown";
import AgentsNavLink from "./AgentsNavLink";
import InboxNavLink from "./InboxNavLink";
import UserMenu from "./UserMenu";
import styles from "../app/(protected)/agents/agents.module.css";

type Props = {
  title?: string;
  subtitle?: string;
};

export default function AgentsTopBar({ title = "AI Agent Control Center", subtitle }: Props) {
  const path = usePathname();
  const agentsHome = path === "/agents";
  const queuePage = path === "/agents/queue";
  const detail = path?.startsWith("/agents/") && path !== "/agents" && path !== "/agents/queue";

  return (
    <header className={styles.topBar}>
      <div className={styles.titleBlock}>
        <Link href="/" className={styles.backLink}>
          ← Team Hub
        </Link>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
        <nav className={styles.subNav} aria-label="Agents sections">
          <Link href="/agents" className={agentsHome && !queuePage && !detail ? styles.subNavActive : undefined}>
            Dashboard
          </Link>
          <Link href="/agents/queue" className={queuePage ? styles.subNavActive : undefined}>
            Review queue
          </Link>
        </nav>
      </div>
      <div className={styles.topBarRight}>
        <Link href="/wiki" className={styles.headerWikiLink}>
          Wiki
        </Link>
        <Link href="/files" className={styles.headerWikiLink}>
          Files
        </Link>
        <EosNavDropdown variant="light" />
        <MarketingNavDropdown variant="light" />
        <AgentsNavLink />
        <InboxNavLink />
        <UserMenu />
      </div>
    </header>
  );
}
