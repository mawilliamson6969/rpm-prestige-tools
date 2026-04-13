"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./MarketingNavDropdown.module.css";

type Props = {
  variant?: "default" | "light" | "hub";
};

export default function MarketingNavDropdown({ variant = "default" }: Props) {
  const path = usePathname();
  const active = path === "/marketing/calendar" || path.startsWith("/marketing/");
  const wrapClass =
    variant === "light" ? `${styles.wrap} ${styles.light}` : variant === "hub" ? `${styles.wrap} ${styles.hub}` : styles.wrap;
  return (
    <details className={wrapClass}>
      <summary className={styles.summary}>Marketing</summary>
      <div className={styles.menu} role="menu">
        <Link
          href="/marketing/calendar"
          className={styles.item}
          role="menuitem"
          style={active ? { fontWeight: 800, color: "#0098d0" } : undefined}
        >
          Content Calendar
        </Link>
      </div>
    </details>
  );
}
