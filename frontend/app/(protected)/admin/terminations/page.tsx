import type { Metadata } from "next";
import { RequireAdmin } from "../../../../context/AuthContext";
import AdminTerminations from "./AdminTerminations";

export const metadata: Metadata = {
  title: "Admin — Terminations | RPM Prestige",
  robots: { index: false, follow: false },
};

export default function AdminTerminationsPage() {
  return (
    <RequireAdmin>
      <AdminTerminations />
    </RequireAdmin>
  );
}
