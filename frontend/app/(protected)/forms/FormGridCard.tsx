"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FormStatus, FormSummary } from "./types";
import styles from "./forms.module.css";
import { categoryTone } from "./categoryTone";
import { formatListDate } from "./FormListRow";

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

export default function FormGridCard({
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
  const subsLabel =
    form.submissionsCount === 1 ? "1 sub" : `${form.submissionsCount} subs`;
  const catLabel = form.category?.trim() || "—";

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  return (
    <div className={styles.formGridCard}>
      <div className={styles.formGridRow1}>
        <div className={styles.formGridTitleRow}>
          <span
            className={`${styles.statusDot} ${statusDotClass(form.status)}`}
            title={statusTitle(form.status)}
            aria-hidden
          />
          <Link
            href={`/forms/builder/${form.id}`}
            className={styles.formGridTitle}
            onClick={(e) => e.stopPropagation()}
          >
            {form.name}
          </Link>
        </div>
        <button
          type="button"
          className={styles.starCellGrid}
          onClick={() => void toggleFavorite(form)}
          title={form.favorited ? "Remove from favorites" : "Add to favorites"}
          aria-label={form.favorited ? "Remove from favorites" : "Add to favorites"}
          aria-pressed={form.favorited}
        >
          <span className={form.favorited ? styles.starFilled : styles.starHollow}>★</span>
        </button>
      </div>
      {form.description ? (
        <p className={styles.formGridDesc}>{form.description}</p>
      ) : (
        <p className={styles.formGridDescEmpty} />
      )}
      <div className={styles.formGridRow3}>
        <span className={`${styles.categoryChip} ${toneClass[tone]}`}>{catLabel}</span>
        <span className={styles.listMuted}>{subsLabel}</span>
        <span className={styles.listMuted}>{formatListDate(form.updatedAt)}</span>
      </div>
      <div className={styles.formGridRow4} ref={wrapRef}>
        <button type="button" className={styles.btnOpenPrimary} onClick={onOpenSubmissions}>
          Open
        </button>
        <div className={styles.dropdownWrap}>
          <button
            type="button"
            className={styles.overflowBtn}
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((o) => !o);
            }}
          >
            ⋯
          </button>
          {menuOpen ? (
            <div className={`${styles.dropdownMenu} ${styles.overflowMenuAlign}`}>
              <button type="button" className={styles.dropdownItem} onClick={() => { setMenuOpen(false); onOpenSubmissions(); }}>
                View submissions
              </button>
              <Link href={`/forms/builder/${form.id}`} className={styles.dropdownItemLink} onClick={() => setMenuOpen(false)}>
                Edit form
              </Link>
              <button type="button" className={styles.dropdownItem} onClick={() => { setMenuOpen(false); onDuplicate(); }}>
                Duplicate
              </button>
              <button type="button" className={styles.dropdownItem} onClick={() => { setMenuOpen(false); onExport(); }}>
                Export
              </button>
              <button type="button" className={styles.dropdownItem} onClick={() => { setMenuOpen(false); onShare(); }}>
                Share link
              </button>
              <button type="button" className={`${styles.dropdownItem} ${styles.dropdownItemDanger}`} onClick={() => { setMenuOpen(false); onArchive(); }}>
                Archive
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
