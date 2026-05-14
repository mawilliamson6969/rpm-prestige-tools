import OperationsTopBar from "../../../OperationsTopBar";
import TriageDashboardClient from "../../../../dashboards/components/TriageDashboardClient";
import styles from "../../../../dashboards/components/dashboards.module.css";

export const dynamic = "force-dynamic";

export default function BoardTriagePage({ params }: { params: { slug: string } }) {
  return (
    <div className={styles.page}>
      <OperationsTopBar />
      <TriageDashboardClient scope="board" boardSlug={params.slug} />
    </div>
  );
}
