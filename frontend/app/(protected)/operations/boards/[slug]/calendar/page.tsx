import OperationsTopBar from "../../../OperationsTopBar";
import CalendarDashboardClient from "../../../../dashboards/components/CalendarDashboardClient";
import styles from "../../../../dashboards/components/dashboards.module.css";

export const dynamic = "force-dynamic";

export default function BoardCalendarPage({ params }: { params: { slug: string } }) {
  return (
    <div className={styles.page}>
      <OperationsTopBar />
      <CalendarDashboardClient scope="board" boardSlug={params.slug} />
    </div>
  );
}
