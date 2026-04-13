import styles from "./files-shell.module.css";

export default function FilesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <div className={styles.main}>{children}</div>
    </div>
  );
}
