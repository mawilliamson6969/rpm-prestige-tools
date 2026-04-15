import PlaybookPageViewClient from "./PlaybookPageViewClient";

export default function PlaybookPageRoute({
  params,
}: {
  params: { categorySlug: string; pageSlug: string };
}) {
  return <PlaybookPageViewClient categorySlug={params.categorySlug} pageSlug={params.pageSlug} />;
}
