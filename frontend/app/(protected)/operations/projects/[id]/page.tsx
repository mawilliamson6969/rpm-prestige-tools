import ProjectDetailClient from "./ProjectDetailClient";

export default function OperationsProjectDetailPage({ params }: { params: { id: string } }) {
  return <ProjectDetailClient projectId={params.id} />;
}
