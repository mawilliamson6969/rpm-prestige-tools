import { Suspense } from "react";
import WikiEditorClient from "../WikiEditorClient";

export default function WikiNewPage() {
  return (
    <Suspense
      fallback={
        <p style={{ color: "#6a737b", padding: "1rem" }}>Loading editor…</p>
      }
    >
      <WikiEditorClient mode="new" />
    </Suspense>
  );
}
