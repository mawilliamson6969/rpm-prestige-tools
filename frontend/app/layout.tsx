import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "RPM Prestige Tools",
  description: "Internal tools",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body style={{ margin: 0, backgroundColor: "#003366" }}>{children}</body>
    </html>
  );
}
