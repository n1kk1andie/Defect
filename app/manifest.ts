import type { MetadataRoute } from "next";

// Web app manifest — makes "Add to Home Screen" install a proper standalone app
// (icon, name, full-screen) on iPhone and Android instead of a Safari bookmark.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pulsus Quality",
    short_name: "Quality",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#E4012B",
    icons: [
      { src: "/pulsus-quality-icon.png", sizes: "any", type: "image/png", purpose: "any" },
      { src: "/pulsus-quality-icon.png", sizes: "any", type: "image/png", purpose: "maskable" },
    ],
  };
}
