import ProcessLibraryClient from "./ProcessLibraryClient";

/**
 * Phase 7.0.1 (PMS visual pass): the canonical Process Library landing
 * page. Hero stats + grid of process-template cards. Cards link to the
 * per-template board at /operations/boards/[slug].
 *
 * The pre-Phase-7 list/table/timeline/calendar view lived here too —
 * those view-helper components (BoardView.tsx, TableView.tsx,
 * TimelineView.tsx, CalendarView.tsx, BulkActionBar.tsx,
 * PerformancePills.tsx, ProcessesListClient.tsx) are kept on disk but
 * are no longer reachable from this page. They will be deleted in 7.1
 * when the unified Template Editor + Board absorb their remaining
 * functionality.
 */
export default function OperationsProcessesPage() {
  return <ProcessLibraryClient />;
}
