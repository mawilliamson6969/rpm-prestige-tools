import WikiEditorClient from "../../../WikiEditorClient";

export default function WikiEditPage({
  params,
}: {
  params: { categorySlug: string; pageSlug: string };
}) {
  return (
    <WikiEditorClient mode="edit" categorySlug={params.categorySlug} pageSlug={params.pageSlug} />
  );
}
