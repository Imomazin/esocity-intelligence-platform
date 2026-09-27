import type { MetadataRoute } from "next";

import { getSiteUrl } from "@/lib/site";

/**
 * Only the public landing page is meant for search engines. The platform pages carry
 * `noindex` (they render synthetic, per-session data) and the API is never crawlable.
 * Preview deployments are excluded entirely.
 */
export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();
  if (process.env.VERCEL_ENV === "preview") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/"] },
    sitemap: new URL("/sitemap.xml", siteUrl).toString(),
    host: siteUrl.origin,
  };
}
