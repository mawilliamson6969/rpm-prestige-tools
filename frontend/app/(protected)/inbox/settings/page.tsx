import { Suspense } from "react";
import SettingsClient from "../../../../components/inbox/settings/SettingsClient";

export default function InboxSettingsPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", color: "#6a737b" }}>
          Loading…
        </div>
      }
    >
      <SettingsClient />
    </Suspense>
  );
}
