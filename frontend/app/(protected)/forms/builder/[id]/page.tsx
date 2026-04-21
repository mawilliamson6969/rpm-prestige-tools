import type { Metadata } from "next";
import FormBuilderClient from "./FormBuilderClient";

export const metadata: Metadata = {
  title: "Form Builder | RPM Prestige",
};

export default function BuilderPage({ params }: { params: { id: string } }) {
  return <FormBuilderClient formId={params.id} />;
}
