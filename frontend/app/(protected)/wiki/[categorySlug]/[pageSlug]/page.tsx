import WikiPageViewClient from "./WikiPageViewClient";

export default function WikiPageRoute({
  params,
}: {
  params: { categorySlug: string; pageSlug: string };
}) {
  return <WikiPageViewClient categorySlug={params.categorySlug} pageSlug={params.pageSlug} />;
}
