import type { MetadataRoute } from "next";

/** Makes PlantOps installable ("Add to Home Screen"); an installed app can receive phone notifications. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PlantOps",
    short_name: "PlantOps",
    description: "Plant operations for RO / packaged drinking water plants",
    id: "/home",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#1d4ed8",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
