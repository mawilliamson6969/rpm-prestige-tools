import type { Metadata } from "next";
import ApprovalsClient from "./ApprovalsClient";

export const metadata: Metadata = {
  title: "My Approvals | RPM Prestige",
};

export default function ApprovalsPage() {
  return <ApprovalsClient />;
}
