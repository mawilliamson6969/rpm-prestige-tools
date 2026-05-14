import ProcessDetailClient from "./ProcessDetailClient";

export const dynamic = "force-dynamic";

export default function ProcessDetailPage({
  params,
}: {
  params: { slug: string; itemId: string };
}) {
  // Phase 7 (Unification): the URL still says /items/[itemId] but the
  // numeric param is a process id now (System A's processes.id).
  const processId = Number(params.itemId);
  if (!Number.isFinite(processId) || processId <= 0) {
    return <div style={{ padding: "2rem" }}>Invalid process ID.</div>;
  }
  return <ProcessDetailClient boardSlug={params.slug} processId={processId} />;
}
