"use client";

import Link from "next/link";
import styles from "./EosNavDropdown.module.css";

export default function EosNavDropdown({ variant = "dark" }: { variant?: "dark" | "light" }) {
  return (
    <details className={`${styles.wrap} ${variant === "light" ? styles.light : ""}`}>
      <summary className={styles.summary}>
        EOS
      </summary>
      <div className={styles.menu} role="menu">
        <Link href="/eos/scorecard" className={styles.item} role="menuitem">
          Scorecard
        </Link>
        <Link href="/eos/rocks" className={styles.item} role="menuitem">
          Rocks
        </Link>
        <Link href="/eos/l10" className={styles.item} role="menuitem">
          L10 Meeting
        </Link>
      </div>
    </details>
  );
}
