import OperationsTopBar from "../../operations/OperationsTopBar";
import CalendarDashboardClient from "../components/CalendarDashboardClient";
import styles from "../components/dashboards.module.css";

export const dynamic = "force-dynamic";

export default function CalendarPage() {
  return (
    <div className={styles.page}>
      <OperationsTopBar />
      <CalendarDashboardClient scope="all" />
    </div>
  );
}
