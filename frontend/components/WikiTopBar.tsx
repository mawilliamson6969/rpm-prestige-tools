"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import EosNavDropdown from "./EosNavDropdown";
import MarketingNavDropdown from "./MarketingNavDropdown";
import AgentsNavLink from "./AgentsNavLink";
import InboxNavLink from "./InboxNavLink";
import UserMenu from "./UserMenu";
import styles from "./wiki-top-bar.module.css";

export default function WikiTopBar() {
  const path = usePathname();
  const wikiActive = path === "/wiki" || path.startsWith("/wiki/");
  const filesActive = path === "/files" || path.startsWith("/files/");
  return (
    <header className={styles.bar}>
      <div className={styles.left}>
        <Link href="/" className={styles.back}>
          ← Team Hub
        </Link>
        <EosNavDropdown variant="light" />
        <MarketingNavDropdown variant="light" />
        <Link href="/wiki" className={`${styles.wikiLink} ${wikiActive ? styles.wikiLinkActive : ""}`}>
          Wiki
        </Link>
        <Link href="/files" className={`${styles.wikiLink} ${filesActive ? styles.wikiLinkActive : ""}`}>
          Files
        </Link>
      </div>
      <div className={styles.right}>
        <AgentsNavLink />
        <InboxNavLink />
        <UserMenu variant="light" />
      </div>
    </header>
  );
}
