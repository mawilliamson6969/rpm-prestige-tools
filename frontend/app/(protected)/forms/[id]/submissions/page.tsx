import type { Metadata } from "next";
import SubmissionsClient from "./SubmissionsClient";

export const metadata: Metadata = {
  title: "Submissions | RPM Prestige",
};

export default function SubmissionsPage({ params }: { params: { id: string } }) {
  return <SubmissionsClient formId={params.id} />;
}
