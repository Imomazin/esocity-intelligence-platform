import type { MetadataRoute } from "next";

import { getSiteUrl } from "@/lib/site";

/** Public, indexable pages only — the demo platform is intentionally noindex. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: new URL("/", getSiteUrl()).toString(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
