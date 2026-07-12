import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VM Building Society — Branch Defects & Operational Standard",
  description: "VMBS branch audit defects and operational standard tracker.",
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
        <footer style={{ textAlign: "center", fontSize: "11px", lineHeight: 1.5, color: "#94a3b8", padding: "20px 12px" }}>
          Powered by Tumblehill Holdings | Proprietary software licensed to Victoria Mutual Building Society | © 2026 All rights reserved
        </footer>
      </body>
    </html>
  );
}
