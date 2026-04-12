import type { Metadata } from "next";
import { RequireAdminRedirect } from "../../../../context/AuthContext";
import AdminSignaturesClient from "./AdminSignaturesClient";

export const metadata: Metadata = {
  title: "Email signatures | Admin | RPM Prestige",
  robots: { index: false, follow: false },
};

export default function AdminSignaturesPage() {
  return (
    <RequireAdminRedirect>
      <AdminSignaturesClient />
    </RequireAdminRedirect>
  );
}
