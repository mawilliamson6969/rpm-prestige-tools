import GenericBoardClient from "./GenericBoardClient";

export const dynamic = "force-dynamic";

export default function GenericBoardPage({ params }: { params: { slug: string } }) {
  return <GenericBoardClient slug={params.slug} />;
}
