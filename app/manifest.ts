import type { MetadataRoute } from "next";

import { siteConfig } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: siteConfig.productName,
    short_name: siteConfig.name,
    description: siteConfig.description,
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#0a0d12",
    theme_color: "#0a0d12",
    categories: ["finance", "sports", "productivity"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/brand/esocity-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/esocity-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
