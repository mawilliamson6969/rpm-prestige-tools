"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import EosNavDropdown from "./EosNavDropdown";
import InboxNavLink from "./InboxNavLink";
import UserMenu from "./UserMenu";
import styles from "./files-top-bar.module.css";

export default function FilesTopBar() {
  const path = usePathname();
  const filesActive = path === "/files" || path.startsWith("/files/");
  const wikiActive = path === "/wiki" || path.startsWith("/wiki/");
  return (
    <header className={styles.bar}>
      <div className={styles.left}>
        <Link href="/" className={styles.back}>
          ← Team Hub
        </Link>
        <EosNavDropdown variant="light" />
        <Link href="/wiki" className={`${styles.navLink} ${wikiActive ? styles.navLinkActive : ""}`}>
          Wiki
        </Link>
        <Link href="/files" className={`${styles.navLink} ${filesActive ? styles.navLinkActive : ""}`}>
          Files
        </Link>
      </div>
      <div className={styles.right}>
        <InboxNavLink />
        <UserMenu variant="light" />
      </div>
    </header>
  );
}
