import { redirect } from "next/navigation";

// /operations itself isn't a real page — the section is tabbed and every
// tab lives at /operations/<tab>. The breadcrumb (and any back link from
// a sub-page) lands here; bounce to the first tab. Tasks is the default
// because it's the most-used entry point.
export default function OperationsIndexPage() {
  redirect("/operations/tasks");
}
