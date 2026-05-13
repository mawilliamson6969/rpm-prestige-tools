import type { Metadata, Viewport } from "next";
import "./globals.css";
import PwaRegister from "../components/PwaRegister";
import { AuthProvider } from "../context/AuthContext";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1B2856",
};

export const metadata: Metadata = {
  title: "RPM Prestige Tools",
  description: "Forms, documents, and internal tools",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "RPM Prestige",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Geist powers the Shared Inbox shell (D0). The font is scoped to
            .inbox-root via inbox-tokens.css so it won't override the rest
            of the app. Preconnect avoids a render-blocking handshake. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;450;500;550;600;700&family=Geist+Mono:wght@400;500&display=swap"
        />
      </head>
      <body style={{ margin: 0, backgroundColor: "#F5F5F5" }}>
        <AuthProvider>{children}</AuthProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
