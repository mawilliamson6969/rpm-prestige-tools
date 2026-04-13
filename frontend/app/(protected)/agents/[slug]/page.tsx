import { Suspense } from "react";
import AgentDetailClient from "./AgentDetailClient";

export default function AgentDetailPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", color: "#6a737b" }}>Loading agent…</div>
      }
    >
      <AgentDetailClient />
    </Suspense>
  );
}
