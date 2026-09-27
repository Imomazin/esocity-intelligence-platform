/** Application version (kept in sync with package.json). */
export const APP_VERSION = "0.1.0";

/**
 * Public, client-safe site configuration. Only NEXT_PUBLIC_* variables may be read here —
 * they are inlined into the browser bundle at build time.
 */

export const siteConfig = {
  name: process.env.NEXT_PUBLIC_APP_NAME?.trim() || "Esocity",
  productName: "Esocity Intelligence",
  tagline: "Predictive Intelligence for Markets & Sport",
  description:
    "Turn complex market and sporting data into probabilities, signals and decision intelligence.",
  disclaimer: "Probabilistic intelligence, not guaranteed outcomes.",
  financialDisclaimer:
    "Model-generated signals are for research and education only. They are not personalised financial advice, an offer, or a solicitation to buy or sell any security.",
  sportsDisclaimer:
    "Sports probabilities are model estimates for analysis only. Esocity does not offer betting or wagering services.",
  engineeringPartner: "AX",
  engineeringPartnerLong: "AX / Ambidexters",
} as const;

/**
 * Absolute site URL for metadata (OpenGraph, sitemap). Order of precedence:
 * NEXT_PUBLIC_APP_URL → Vercel production domain → Vercel deployment URL → local dev.
 * The localhost fallback is only reachable outside Vercel.
 */
export function getSiteUrl(): URL {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) {
    try {
      return new URL(explicit);
    } catch {
      // fall through to platform defaults
    }
  }
  const vercelProduction = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProduction) return new URL(`https://${vercelProduction}`);
  const vercelDeployment = process.env.VERCEL_URL?.trim();
  if (vercelDeployment) return new URL(`https://${vercelDeployment}`);
  return new URL(`http://localhost:${process.env.PORT ?? 3000}`);
}
