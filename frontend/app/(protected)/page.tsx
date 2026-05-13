import type { Metadata } from "next";
import Hub from "../Hub";

export const metadata: Metadata = {
  title: "Hub | RPM Prestige",
  description: "Internal home base for Real Property Management Prestige.",
};

export default function HomePage() {
  return <Hub />;
}
