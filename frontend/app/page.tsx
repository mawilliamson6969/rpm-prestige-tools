import type { Metadata } from "next";
import FormsHub from "./FormsHub";

export const metadata: Metadata = {
  title: "Forms & Documents | RPM Prestige",
  description: "Submit and manage company forms securely.",
};

export default function HomePage() {
  return <FormsHub />;
}
