import TemplateEditorClient from "./TemplateEditorClient";

export default function OperationsTemplateEditorPage({ params }: { params: { id: string } }) {
  return <TemplateEditorClient templateId={params.id} />;
}
