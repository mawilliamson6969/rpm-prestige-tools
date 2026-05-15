import BoardClient from "./BoardClient";
import ProcessTabStrip, { type ProcessTab } from "./ProcessTabStrip";
import TabStubContent from "./TabStubContent";
import StagesWorkflowsClient from "./StagesWorkflowsClient";
import MessageTemplatesClient from "./MessageTemplatesClient";
import CustomFieldsClient from "./CustomFieldsClient";

export const dynamic = "force-dynamic";

const VALID_TABS: ProcessTab[] = [
  "board",
  "stages",
  "autopilot",
  "email",
  "text",
  "fields",
  "settings",
];

function resolveTab(value: string | string[] | undefined): ProcessTab {
  if (typeof value !== "string") return "board";
  return (VALID_TABS as string[]).includes(value) ? (value as ProcessTab) : "board";
}

/**
 * Phase 7.0.1: the per-template page is now a tabbed shell.
 * `tab=board` (default) renders the Phase 7 BoardClient unchanged.
 * Other tabs render a stub announcing which phase they ship in.
 *
 * Tabs use a `?tab=...` query param to avoid spinning up six empty
 * route segments today. When 7.1 fills in real content, individual
 * tabs can be promoted to their own route folders if it helps with
 * code-splitting / loading states.
 */
export default function BoardPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams?: { tab?: string | string[] };
}) {
  const tab = resolveTab(searchParams?.tab);
  return (
    <>
      <ProcessTabStrip slug={params.slug} active={tab} />
      {tab === "board" && <BoardClient slug={params.slug} />}
      {tab === "stages" && <StagesWorkflowsClient slug={params.slug} />}
      {tab === "email" && <MessageTemplatesClient slug={params.slug} mode="email" />}
      {tab === "text" && <MessageTemplatesClient slug={params.slug} mode="text" />}
      {tab === "fields" && <CustomFieldsClient slug={params.slug} />}
      {(tab === "autopilot" || tab === "settings") && (
        <TabStubContent slug={params.slug} tab={tab} />
      )}
    </>
  );
}
