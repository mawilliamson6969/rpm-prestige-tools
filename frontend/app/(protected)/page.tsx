import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import IntranetHub from "../IntranetHub";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Team Hub | RPM Prestige",
  description: "Internal home base for Real Property Management Prestige.",
};

export default function HomePage() {
  return (
    <div className={dmSans.className} style={{ minHeight: "100vh" }}>
      <IntranetHub />
    </div>
  );
}
