import type { Metadata } from "next";
import AnnouncementsLibrary from "./AnnouncementsLibrary";

export const metadata: Metadata = {
  title: "Announcements | RPM Prestige",
  robots: { index: false, follow: false },
};

export default function AnnouncementsPage() {
  return <AnnouncementsLibrary />;
}
