import type { Metadata } from "next";
import styles from "./eos.module.css";

export const metadata: Metadata = {
  title: "EOS | RPM Prestige",
  description: "Scorecard, Rocks, and L10 meeting tools.",
};

export default function EosLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <div className={styles.main}>{children}</div>
    </div>
  );
}
