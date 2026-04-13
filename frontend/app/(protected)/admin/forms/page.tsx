import type { Metadata } from "next";
import { Suspense } from "react";
import { RequireAdmin } from "../../../../context/AuthContext";
import AdminFormLibrary from "./AdminFormLibrary";

export const metadata: Metadata = {
  title: "Admin — Form Submissions | RPM Prestige",
  robots: { index: false, follow: false },
};

export default function AdminFormsPage() {
  return (
    <RequireAdmin>
      <Suspense
        fallback={
          <p style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", color: "#6a737b" }}>Loading…</p>
        }
      >
        <AdminFormLibrary />
      </Suspense>
    </RequireAdmin>
  );
}
