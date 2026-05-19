import type { Metadata } from "next";
import RunsClient from "./RunsClient";

export const metadata: Metadata = {
  title: "Automation runs | RPM Prestige",
};

export default function AutomationRunsPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return <div style={{ padding: 24 }}>Invalid automation id.</div>;
  }
  return <RunsClient automationId={id} />;
}
