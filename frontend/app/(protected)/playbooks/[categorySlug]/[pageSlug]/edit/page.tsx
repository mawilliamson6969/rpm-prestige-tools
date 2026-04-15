import PlaybookEditorClient from "../../../PlaybookEditorClient";

export default function PlaybookEditPage({
  params,
}: {
  params: { categorySlug: string; pageSlug: string };
}) {
  return (
    <PlaybookEditorClient mode="edit" categorySlug={params.categorySlug} pageSlug={params.pageSlug} />
  );
}
