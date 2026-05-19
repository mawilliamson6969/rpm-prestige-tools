import type { Metadata } from "next";
import AutomationEditorClient from "./AutomationEditorClient";

export const metadata: Metadata = {
  title: "Edit automation | RPM Prestige",
};

export default function AutomationEditorPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return <div style={{ padding: 24 }}>Invalid automation id.</div>;
  }
  return <AutomationEditorClient automationId={id} />;
}
