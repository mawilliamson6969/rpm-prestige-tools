"use client";

import { useEffect, useState } from "react";
import type { WikiHeading } from "./markdown-toc";
import styles from "./wiki-toc.module.css";

type Props = {
  headings: WikiHeading[];
};

export default function WikiToc({ headings }: Props) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (!headings.length) return;
    const ids = headings.map((h) => h.id);
    const els = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    if (!els.length) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => (a.target as HTMLElement).offsetTop - (b.target as HTMLElement).offsetTop);
        const pick = visible[0] ?? entries.sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const id = pick?.target?.id;
        if (id) setActive(id);
      },
      { rootMargin: "-12% 0px -62% 0px", threshold: [0, 0.1, 0.25, 0.5, 1] }
    );
    for (const el of els) obs.observe(el);
    return () => obs.disconnect();
  }, [headings]);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(id);
  };

  if (!headings.length) return null;

  return (
    <>
      <div className={styles.mobileToc}>
        <label htmlFor="wiki-toc-select" className={styles.visuallyHidden}>
          Jump to section
        </label>
        <select
          id="wiki-toc-select"
          value={active ?? headings[0].id}
          onChange={(e) => scrollTo(e.target.value)}
        >
          {headings.map((h) => (
            <option key={h.id} value={h.id}>
              {h.level === 3 ? "  " : ""}
              {h.text}
            </option>
          ))}
        </select>
      </div>
      <nav className={styles.toc} aria-label="On this page">
        <p className={styles.tocTitle}>On this page</p>
        <ul className={styles.tocList}>
          {headings.map((h) => (
            <li key={h.id} className={h.level === 3 ? styles.tocH3 : undefined}>
              <a
                href={`#${h.id}`}
                className={(active ?? headings[0]?.id) === h.id ? styles.active : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  scrollTo(h.id);
                }}
              >
                {h.text}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
