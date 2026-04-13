import { Suspense } from "react";
import AskAiFloatingWidget from "../../components/AskAiFloatingWidget";
import SidebarLayout from "../../components/SidebarLayout";
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
      <RequireAuth>
        <SidebarLayout>{children}</SidebarLayout>
        <AskAiFloatingWidget />
      </RequireAuth>
    </Suspense>
  );
}
