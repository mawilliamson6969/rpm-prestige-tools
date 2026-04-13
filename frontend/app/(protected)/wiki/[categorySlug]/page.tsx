import WikiCategoryClient from "./WikiCategoryClient";

export default function WikiCategoryPage({ params }: { params: { categorySlug: string } }) {
  return <WikiCategoryClient categorySlug={params.categorySlug} />;
}
