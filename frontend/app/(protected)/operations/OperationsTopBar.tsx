"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import styles from "./operations.module.css";
import { useAuth } from "../../../context/AuthContext";

export default function OperationsTopBar({ actions }: { actions?: ReactNode }) {
  const pathname = usePathname() || "/";
  const { isAdmin } = useAuth();
  const links = [
    { href: "/operations/tasks", label: "Tasks" },
    { href: "/operations/projects", label: "Projects" },
    { href: "/operations/processes", label: "Processes" },
    ...(isAdmin ? [{ href: "/operations/templates", label: "Templates" }] : []),
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
