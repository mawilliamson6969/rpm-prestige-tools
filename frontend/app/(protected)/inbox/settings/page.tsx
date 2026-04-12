import { Suspense } from "react";
import InboxSettingsClient from "./InboxSettingsClient";

export default function InboxSettingsPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", color: "#6a737b" }}>Loading…</div>
      }
    >
      <InboxSettingsClient />
    </Suspense>
  );
}
