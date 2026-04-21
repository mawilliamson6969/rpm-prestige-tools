import type { Metadata } from "next";
import FormsListClient from "./FormsListClient";

export const metadata: Metadata = {
  title: "Forms | RPM Prestige",
  description: "Build and manage custom forms",
};

export default function FormsPage() {
  return <FormsListClient />;
}
