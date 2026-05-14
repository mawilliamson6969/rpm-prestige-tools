import OperationsTopBar from "../../operations/OperationsTopBar";
import TriageDashboardClient from "../components/TriageDashboardClient";
import styles from "../components/dashboards.module.css";

export const dynamic = "force-dynamic";

export default function TriagePage() {
  return (
    <div className={styles.page}>
      <OperationsTopBar />
      <TriageDashboardClient scope="all" />
    </div>
  );
}
