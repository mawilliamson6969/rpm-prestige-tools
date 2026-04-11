import type { Metadata } from "next";
import OwnerTerminationForm from "./OwnerTerminationForm";

export const metadata: Metadata = {
  title: "Owner Request to Terminate Management | RPM Prestige",
  description: "Submit an owner request to terminate property management.",
};

export default function OwnerTerminationPage() {
  return <OwnerTerminationForm />;
}
