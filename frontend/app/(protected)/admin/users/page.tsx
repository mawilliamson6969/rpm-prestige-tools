import type { Metadata } from "next";
import { RequireAdminRedirect } from "../../../../context/AuthContext";
import UsersAdminClient from "./UsersAdminClient";

export const metadata: Metadata = {
  title: "User Management | RPM Prestige",
  robots: { index: false, follow: false },
};

export default function AdminUsersPage() {
  return (
    <RequireAdminRedirect>
      <UsersAdminClient />
    </RequireAdminRedirect>
  );
}
