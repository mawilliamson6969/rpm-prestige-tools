import type { Metadata } from "next";
import DashboardClient from "./DashboardClient";

export const metadata: Metadata = {
  title: "Executive Dashboard | RPM Prestige",
  description: "Cached AppFolio KPIs, leasing, maintenance, finance, and portfolio views.",
};

export default function DashboardPage() {
  return <DashboardClient />;
}
