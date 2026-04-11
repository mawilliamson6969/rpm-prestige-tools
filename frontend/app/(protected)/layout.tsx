import { Suspense } from "react";
import { RequireAuth } from "../../context/AuthContext";

export default function ProtectedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: "40vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#6a737b",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          Loading…
        </div>
      }
    >
      <RequireAuth>{children}</RequireAuth>
    </Suspense>
  );
}
