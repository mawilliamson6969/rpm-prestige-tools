"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import styles from "./operations.module.css";

export default function OperationsTopBar({ actions }: { actions?: ReactNode }) {
  const pathname = usePathname() || "/";
  // Three Phase-7 cleanups (Renewals (Beta), Manage Boards, Templates) are
  // intentionally absent:
  //   * Renewals (Beta) → users land here via Processes → "Lease Renewal"
  //     tile. The standalone tab was a pre-unification convenience.
  //   * Manage Boards → /operations/boards/manage was never a real page;
  //     the boards/[slug] catch-all would try to resolve "manage" as a
  //     template slug and 404.
  //   * Templates → the pre-Phase-7 standalone editor. The canonical
  //     editor is now the "Stages" tab inside the per-template board
  //     view (see operations/boards/[slug]/page.tsx header comment).
  const links = [
    { href: "/operations/tasks", label: "Tasks" },
    { href: "/operations/my-tasks", label: "My Tasks" },
    { href: "/operations/projects", label: "Projects" },
    { href: "/operations/processes", label: "Processes" },
    { href: "/operations/analytics", label: "Analytics" },
    { href: "/operations/insights", label: "AI Insights" },
  ];
  return (
    <div className={styles.topBar}>
      <div className={styles.titleBlock}>
        <h1>Operations Hub</h1>
        <p>Tasks, processes, and team workflows</p>
      </div>
      <nav className={styles.navLinks}>
        {links.map((l) => {
          const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`${styles.navLink} ${active ? styles.navActive : ""}`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
      {actions ? <div className={styles.topActions}>{actions}</div> : null}
    </div>
  );
}
