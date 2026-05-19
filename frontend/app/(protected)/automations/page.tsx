import type { Metadata } from "next";
import AutomationsListClient from "./AutomationsListClient";

export const metadata: Metadata = {
  title: "Automations | RPM Prestige",
  description: "Zap-style automations that react to events from AppFolio, OpenPhone, Microsoft 365 and internal forms.",
};

export default function AutomationsPage() {
  return <AutomationsListClient />;
}
