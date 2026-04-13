import type { Metadata } from "next";
import { Suspense } from "react";
import DashboardClient from "./DashboardClient";

export const metadata: Metadata = {
  title: "Executive Dashboard | RPM Prestige",
  description: "Cached AppFolio KPIs, leasing, maintenance, finance, and portfolio views.",
};

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: "2rem", color: "#6a737b", fontFamily: "system-ui, sans-serif" }}>Loading dashboard…</div>
      }
    >
      <DashboardClient />
    </Suspense>
  );
}
