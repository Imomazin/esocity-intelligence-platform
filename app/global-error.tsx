"use client";

/**
 * Last-resort error boundary (replaces the root layout when it fails). Must render its own
 * <html> and <body> and cannot rely on global CSS having loaded, so styles are inline.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
          background: "#f5f6f8",
          color: "#0b1220",
        }}
      >
        <main style={{ maxWidth: 480, padding: 24, textAlign: "center" }}>
          <p style={{ letterSpacing: "0.28em", fontWeight: 600, fontSize: 14 }}>ESOCITY</p>
          <h1 style={{ fontSize: 22, margin: "16px 0 8px" }}>Something went wrong</h1>
          <p style={{ color: "#5b6474", fontSize: 14 }}>
            An unexpected error occurred. Please try again.
            {error.digest ? ` Reference: ${error.digest}` : ""}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 16,
              padding: "8px 16px",
              borderRadius: 6,
              border: 0,
              background: "#256abf",
              color: "#ffffff",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
