import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "Pulsus Quality",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Pulsus Quality" },
  icons: { icon: "/pulsus-quality-icon.png", shortcut: "/pulsus-quality-icon.png", apple: "/pulsus-quality-icon.png" },
  title: "Pulsus Quality — Branch Defects & Operational Standard",
  description: "Pulsus Quality branch audit defects and operational standard tracker.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=IBM+Plex+Sans:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}
        <footer style={{ textAlign: "center", fontSize: "10.5px", lineHeight: 1.5, color: "#B7ADA8", padding: "18px 16px calc(96px + env(safe-area-inset-bottom))" }}>
          Developed by Tumblehill Labs, the product studio of Tumblehill Holdings Limited. © 2026 Tumblehill Holdings Limited · Proprietary Software · All Rights Reserved
        </footer>
      </body>
    </html>
  );
}
