import { redirect } from "next/navigation";

// /operations/boards isn't a real landing page — there's no "all boards"
// dashboard. Pre-Phase-7 this redirected to /operations/boards/renewals
// (the Lease Renewal board), but that was a holdover from when Renewals
// was the only board: it now silently drops anyone clicking the "Boards"
// breadcrumb segment onto a single template's view, which reads as the
// app showing the wrong thing.
//
// Post-Phase-7 the canonical entry for every per-template board is the
// Process Library (cards link to /operations/boards/<slug>), so we send
// callers there instead. Direct deep links like /operations/boards/<slug>
// keep working — only the bare /operations/boards index is rerouted.
export default function OperationsBoardsIndex() {
  redirect("/operations/processes");
}
