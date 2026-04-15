import type { Metadata } from "next";
import styles from "./playbook-shell.module.css";

export const metadata: Metadata = {
  title: "Playbooks & SOPs | RPM Prestige",
  description: "Standard operating procedures and playbooks for property management.",
};

export default function PlaybookLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <div className={styles.main}>{children}</div>
    </div>
  );
}
