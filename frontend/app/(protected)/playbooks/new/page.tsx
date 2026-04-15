import { Suspense } from "react";
import PlaybookEditorClient from "../PlaybookEditorClient";

export default function PlaybookNewPage() {
  return (
    <Suspense
      fallback={
        <p style={{ color: "#6a737b", padding: "1rem" }}>Loading editor…</p>
      }
    >
      <PlaybookEditorClient mode="new" />
    </Suspense>
  );
}
