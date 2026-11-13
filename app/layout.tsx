import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pulsus Quality",
  description: "Pulsus Quality: branch and operational quality, inspections and corrective actions. Live. Signal. Clarity.",
  applicationName: "Pulsus Quality",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/pulsus-quality-icon.png", apple: "/pulsus-quality-icon.png" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#F6EFE4" }, { media: "(prefers-color-scheme: dark)", color: "#0A0F2C" }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Day or night before first paint: the visitor's choice ("pz-theme", shared with Pulsus Platform), else the device's. */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem("pz-theme");if(t!=="dark"&&t!=="light")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t;}catch(e){}})();` }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
