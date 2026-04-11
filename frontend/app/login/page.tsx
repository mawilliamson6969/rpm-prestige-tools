import type { Metadata } from "next";
import LoginClient from "./LoginClient";

export const metadata: Metadata = {
  title: "Sign In | RPM Prestige",
  description: "Team sign-in for RPM Prestige internal tools.",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return <LoginClient />;
}
