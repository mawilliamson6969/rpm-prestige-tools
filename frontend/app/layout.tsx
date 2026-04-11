import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "../context/AuthContext";

export const metadata: Metadata = {
  title: "RPM Prestige Tools",
  description: "Forms, documents, and internal tools",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body style={{ margin: 0, backgroundColor: "#F5F5F5" }}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
