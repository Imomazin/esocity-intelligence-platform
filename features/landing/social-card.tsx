import { siteConfig } from "@/lib/site";

export const SOCIAL_CARD_SIZE = { width: 1200, height: 630 } as const;
export const SOCIAL_CARD_ALT = `${siteConfig.productName} — ${siteConfig.tagline}`;

/**
 * Social preview card rendered by next/og (Satori). Satori supports a subset of CSS: flexbox
 * layout only and inline styles, so this component is deliberately plain.
 */
export function SocialCard() {
  const bars = [
    { height: 26, opacity: 0.7 },
    { height: 46, opacity: 0.85 },
    { height: 64, opacity: 1 },
  ];
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px 80px",
        backgroundColor: "#0a0d12",
        backgroundImage:
          "radial-gradient(circle at 85% 10%, rgba(109,167,236,0.22), transparent 45%), linear-gradient(135deg, #0a0d12 0%, #11161d 100%)",
        color: "#f3f5f8",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
        <div
          style={{
            width: 88,
            height: 88,
            borderRadius: 22,
            backgroundColor: "#256abf",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            gap: 10,
            paddingBottom: 20,
          }}
        >
          {bars.map((bar, index) => (
            <div
              key={index}
              style={{
                width: 13,
                height: bar.height,
                borderRadius: 4,
                backgroundColor: `rgba(255,255,255,${bar.opacity})`,
              }}
            />
          ))}
        </div>
        <div style={{ display: "flex", fontSize: 34, fontWeight: 700, letterSpacing: 10 }}>
          ESOCITY
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div
          style={{
            display: "flex",
            fontSize: 66,
            fontWeight: 700,
            lineHeight: 1.08,
            maxWidth: 980,
          }}
        >
          {siteConfig.tagline}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 30,
            color: "#aab4c3",
            maxWidth: 940,
            lineHeight: 1.35,
          }}
        >
          {siteConfig.description}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 14 }}>
          {["Markets", "Sports", "Trade"].map((label) => (
            <div
              key={label}
              style={{
                display: "flex",
                padding: "10px 22px",
                borderRadius: 999,
                border: "1px solid #2a3340",
                fontSize: 24,
                color: "#d7dde6",
              }}
            >
              {label}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", fontSize: 22, color: "#8a94a3" }}>
          {siteConfig.disclaimer}
        </div>
      </div>
    </div>
  );
}
