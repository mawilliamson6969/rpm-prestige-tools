"use client";

import styles from "./inbox-shell.module.css";

type Props = {
  eyebrow: string;
  title: string;
  description: string;
  badge?: string;
};

export default function InboxPlaceholder({ eyebrow, title, description, badge }: Props) {
  return (
    <div className={styles.placeholder}>
      <div className={styles.placeholderInner}>
        <div className={styles.placeholderEyebrow}>{eyebrow}</div>
        <h1 className={styles.placeholderTitle}>{title}</h1>
        <p className={styles.placeholderSub}>{description}</p>
        {badge ? <span className={styles.placeholderBadge}>{badge}</span> : null}
      </div>
    </div>
  );
}
