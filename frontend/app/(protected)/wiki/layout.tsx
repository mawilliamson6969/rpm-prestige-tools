import styles from "./wiki-shell.module.css";

export default function WikiLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <div className={styles.main}>{children}</div>
    </div>
  );
}
