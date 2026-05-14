import ProcessRedirectClient from "./ProcessRedirectClient";

export const dynamic = "force-dynamic";

/**
 * Phase 7 (Unification): legacy URL → unified board URL via a small
 * client component that resolves the process's template slug.
 */
export default function LegacyProcessPage({ params }: { params: { id: string } }) {
  return <ProcessRedirectClient legacyId={params.id} />;
}
