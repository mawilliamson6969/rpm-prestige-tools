"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormStatus, FormSummary } from "./types";
import styles from "./forms.module.css";
import { categoryTone } from "./categoryTone";

type Props = {
  form: FormSummary;
  toggleFavorite: (form: FormSummary) => Promise<void>;
  onOpenSubmissions: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onArchive: () => void;
  onShare: () => void;
  toneClass: Record<ReturnType<typeof categoryTone>, string>;
};

function statusDotClass(s: FormStatus) {
  if (s === "published") return styles.statusDotPublished;
  if (s === "archived") return styles.statusDotArchived;
  return styles.statusDotDraft;
}

function statusTitle(s: FormStatus) {
  if (s === "published") return "Published";
  if (s === "archived") return "Archived";
  return "Draft";
}

/** Short date e.g. Apr 22 — include year when not current year. */
export function formatListDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {}),
  };
  return d.toLocaleDateString("en-US", opts);
}

export default function FormListRow({
  form,
  toggleFavorite,
  onOpenSubmissions,
  onDuplicate,
  onExport,
  onArchive,
  onShare,
  toneClass,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tone = categoryTone(form.category);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !(e.target as HTMLElement).closest("button,a,input,textarea,select")) {
        e.preventDefault();
        onOpenSubmissions();
      }
    },
    [onOpenSubmissions],
  );

  const subsLabel =
    form.submissionsCount === 1 ? "1 sub" : `${form.submissionsCount} subs`;

  const catLabel = form.category?.trim() || "—";

  return (
    <div className={styles.listRowOuter} onKeyDown={onKeyDown}>
      <div
        className={styles.listRow}
        tabIndex={0}
        aria-label={`${form.name}, ${subsLabel}`}
        onClick={(e) => {
          const el = e.target as HTMLElement;
          if (el.closest("button, a, input, textarea, select, [role='menu'], [role='menuitem'], [href]"))
            return;
          onOpenSubmissions();
        }}
      >
        <button
          type="button"
          className={styles.starCell}
          onClick={(e) => {
            e.stopPropagation();
            void toggleFavorite(form);
          }}
          title={form.favorited ? "Remove from favorites" : "Add to favorites"}
          aria-label={form.favorited ? "Remove from favorites" : "Add to favorites"}
          aria-pressed={form.favorited}
        >
          <span className={form.favorited ? styles.starFilled : styles.starHollow}>★</span>
        </button>

        <div className={styles.listRowMain}>
          <div className={styles.listRowTopDesktop}>
            <span
              className={`${styles.statusDot} ${statusDotClass(form.status)}`}
              title={statusTitle(form.status)}
              aria-hidden
            />
            <Link
              href={`/forms/builder/${form.id}`}
              className={styles.listFormTitle}
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              {form.name}
            </Link>
            <span className={`${styles.categoryChip} ${toneClass[tone]}`}>{catLabel}</span>
            <span className={styles.listMuted}>{subsLabel}</span>
            <span className={styles.listMuted}>{formatListDate(form.updatedAt)}</span>
          </div>
          <div className={styles.listRowMobileTop}>
            <span
              className={`${styles.statusDot} ${statusDotClass(form.status)}`}
              title={statusTitle(form.status)}
              aria-hidden
            />
            <Link
              href={`/forms/builder/${form.id}`}
              className={styles.listFormTitle}
              onClick={(e) => e.stopPropagation()}
            >
              {form.name}
            </Link>
          </div>
          {form.description ? (
            <p className={styles.listDesc}>{form.description}</p>
          ) : (
            <p className={styles.listDescSpacer} />
          )}
          <div className={styles.listRowMobileMeta}>
            <span className={`${styles.categoryChip} ${toneClass[tone]}`}>{catLabel}</span>
            <span className={styles.listMuted}>{subsLabel}</span>
            <span className={styles.listMuted}>{formatListDate(form.updatedAt)}</span>
          </div>
        </div>

        <div className={styles.listRowActions} ref={wrapRef}>
          <button type="button" className={styles.btnOpenPrimary} onClick={onOpenSubmissions}>
            Open
          </button>
          <div className={styles.dropdownWrap}>
            <button
              type="button"
              className={styles.overflowBtn}
              aria-expanded={menuOpen}
              aria-haspopup="true"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((o) => !o);
              }}
            >
              ⋯
            </button>
            {menuOpen ? (
              <div className={`${styles.dropdownMenu} ${styles.overflowMenuAlign}`} role="menu">
                <button type="button" className={styles.dropdownItem} role="menuitem" onClick={() => { setMenuOpen(false); onOpenSubmissions(); }}>
                  View submissions
                  <span className={styles.menuKbd}>Enter</span>
                </button>
                <Link href={`/forms/builder/${form.id}`} className={styles.dropdownItemLink} role="menuitem" onClick={() => setMenuOpen(false)}>
                  Edit form
                </Link>
                <button type="button" className={styles.dropdownItem} role="menuitem" onClick={() => { setMenuOpen(false); onDuplicate(); }}>
                  Duplicate
                </button>
                <button type="button" className={styles.dropdownItem} role="menuitem" onClick={() => { setMenuOpen(false); onExport(); }}>
                  Export
                </button>
                <button type="button" className={styles.dropdownItem} role="menuitem" onClick={() => { setMenuOpen(false); onShare(); }}>
                  Share link
                </button>
                <button
                  type="button"
                  className={`${styles.dropdownItem} ${styles.dropdownItemDanger}`}
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); onArchive(); }}
                >
                  Archive
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
