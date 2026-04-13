"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
    </header>
  );
}
