import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV !== "production";
// Vercel preview deployments inject the Vercel Toolbar (vercel.live). Allow it only there.
const isVercelPreview = process.env.VERCEL_ENV === "preview";

function buildContentSecurityPolicy(): string {
  const vercelLive = isVercelPreview ? ["https://vercel.live"] : [];
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // Next.js App Router hydration uses inline scripts. A nonce-based policy would force every
    // page to render dynamically; see docs/SECURITY.md for the trade-off and upgrade path.
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      ...(isDevelopment ? ["'unsafe-eval'"] : []),
      ...vercelLive,
    ],
    "style-src": ["'self'", "'unsafe-inline'", ...vercelLive],
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      ...vercelLive,
      ...(isVercelPreview ? ["https://vercel.com"] : []),
    ],
    "font-src": [
      "'self'",
      "data:",
      ...(isVercelPreview ? ["https://vercel.live", "https://assets.vercel.com"] : []),
    ],
    "connect-src": [
      "'self'",
      ...(isDevelopment ? ["ws:", "wss:"] : []),
      ...vercelLive,
      ...(isVercelPreview ? ["wss://ws-us3.pusher.com"] : []),
    ],
    "frame-src": [...(isVercelPreview ? ["https://vercel.live"] : ["'none'"])],
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "worker-src": ["'self'", "blob:"],
  };

  const policy = Object.entries(directives)
    .map(([directive, sources]) => `${directive} ${sources.join(" ")}`)
    .join("; ");

  return isDevelopment ? policy : `${policy}; upgrade-insecure-requests`;
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: buildContentSecurityPolicy() },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  ...(isDevelopment
    ? []
    : [
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
      ]),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Vercel does not need standalone output. The root Dockerfile sets NEXT_OUTPUT=standalone
  // for self-hosted container builds.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  experimental: {
    optimizePackageImports: ["recharts"],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
