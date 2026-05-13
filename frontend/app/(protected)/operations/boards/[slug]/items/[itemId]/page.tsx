import ItemDetailClient from "./ItemDetailClient";

export const dynamic = "force-dynamic";

export default function ItemDetailPage({
  params,
}: {
  params: { slug: string; itemId: string };
}) {
  const itemId = Number(params.itemId);
  if (!Number.isFinite(itemId) || itemId <= 0) {
    return <div style={{ padding: "2rem" }}>Invalid item ID.</div>;
  }
  return <ItemDetailClient boardSlug={params.slug} itemId={itemId} />;
}
