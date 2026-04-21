import type { Metadata } from "next";
import FormRenderer from "./FormRenderer";

export const metadata: Metadata = {
  title: "Form | RPM Prestige",
};

export default function PublicFormPage({ params }: { params: { id: string } }) {
  return <FormRenderer slug={params.id} />;
}
