import ProcessDetailClient from "./ProcessDetailClient";

export default function OperationsProcessDetailPage({ params }: { params: { id: string } }) {
  return <ProcessDetailClient processId={params.id} />;
}
