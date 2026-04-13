import WikiTopBar from "../../../components/WikiTopBar";
import styles from "./wiki-shell.module.css";

export default function WikiLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <WikiTopBar />
      <div className={styles.main}>{children}</div>
    </div>
  );
}
