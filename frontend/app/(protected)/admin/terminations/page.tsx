"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { RequireAdmin } from "../../../../context/AuthContext";

export default function LegacyAdminTerminationsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/forms?type=owner-termination");
  }, [router]);
  return (
    <RequireAdmin>
      <p style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", color: "#6a737b" }}>Redirecting…</p>
    </RequireAdmin>
  );
}
