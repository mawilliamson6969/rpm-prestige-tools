import FilesTopBar from "../../../components/FilesTopBar";
import styles from "./files-shell.module.css";

export default function FilesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <FilesTopBar />
      <div className={styles.main}>{children}</div>
    </div>
  );
}
