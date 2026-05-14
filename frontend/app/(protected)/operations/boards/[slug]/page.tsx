import BoardClient from "./BoardClient";

export const dynamic = "force-dynamic";

export default function BoardPage({ params }: { params: { slug: string } }) {
  return <BoardClient slug={params.slug} />;
}
