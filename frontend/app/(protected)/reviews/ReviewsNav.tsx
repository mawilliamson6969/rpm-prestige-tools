"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./reviews.module.css";

const ITEMS = [
  { href: "/reviews", label: "Inbox" },
  { href: "/reviews/send", label: "Send Request" },
  { href: "/reviews/templates", label: "Templates" },
  { href: "/reviews/automations", label: "Automations" },
  { href: "/reviews/leaderboard", label: "Leaderboard" },
  { href: "/reviews/analytics", label: "Analytics" },
  { href: "/reviews/setup", label: "Setup" },
] as const;

export default function ReviewsNav() {
  const pathname = usePathname() || "/";
  return (
    <nav className={styles.subNav} aria-label="Reviews sub-navigation">
      {ITEMS.map((i) => {
        const active = i.href === "/reviews" ? pathname === "/reviews" : pathname.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} className={active ? styles.subNavActive : ""}>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
