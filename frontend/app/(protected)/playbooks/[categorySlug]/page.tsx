import PlaybookCategoryClient from "./PlaybookCategoryClient";

export default function PlaybookCategoryPage({ params }: { params: { categorySlug: string } }) {
  return <PlaybookCategoryClient categorySlug={params.categorySlug} />;
}
