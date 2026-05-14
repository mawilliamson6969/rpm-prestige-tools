"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import dashStyles from "../../../dashboards/components/dashboards.module.css";

/**
 * Table / Triage / Calendar tab nav on each board page header.
 * Renewals lives at /operations/boards/renewals — its "table" link is
 * exactly that path. All other boards live at /operations/boards/[slug]
 * — same pattern with the slug substituted.
 */
export default function BoardTabs({ boardSlug }: { boardSlug: string }) {
  const pathname = usePathname() || "";
  const base = `/operations/boards/${boardSlug}`;
  const tabs = [
    { label: "Table", href: base },
    { label: "Triage", href: `${base}/triage` },
    { label: "Calendar", href: `${base}/calendar` },
  ];
  return (
    <nav className={dashStyles.boardTabs} aria-label="Board views">
      {tabs.map((t) => {
        const active =
          (t.href === base && pathname === base) ||
          (t.href !== base && pathname === t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`${dashStyles.boardTab} ${active ? dashStyles.boardTabActive : ""}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
