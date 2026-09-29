import { afterEach, describe, expect, it } from "vitest";

import { getLandingPreview } from "@/features/landing/queries";
import { getShellData } from "@/features/platform/queries";
import { DataUnavailableError } from "@/lib/api/errors";
import { getNow, getUsMarketSession } from "@/lib/clock";
import { NYSE_CALENDAR } from "@/lib/markets/calendar";
import { setMarketDataProviderForTesting } from "@/lib/markets/providers";
import type { MarketDataProvider } from "@/lib/markets/providers/types";

/** A licensed provider whose store has nothing ingested yet. */
const EMPTY_LICENSED: MarketDataProvider = {
  id: "empty-licensed",
  displayName: "Licensed feed",
  isSimulated: false,
  getSession: () => getUsMarketSession(getNow(), NYSE_CALENDAR),
  getDataVersion: async () => "empty",
  listAssets: async () => {
    throw new DataUnavailableError("No market data has been ingested yet.");
  },
  getAsset: async () => null,
  getDailyBars: async () => [],
  getQuote: async () => {
    throw new DataUnavailableError("No market data has been ingested yet.");
  },
};

afterEach(() => setMarketDataProviderForTesting(null));

describe("licensed data unavailable", () => {
  it("keeps the platform shell usable and says what is wrong", async () => {
    setMarketDataProviderForTesting(EMPTY_LICENSED);
    const shell = await getShellData();
    const ids = shell.notifications.map((notification) => notification.id);
    expect(ids).toContain("data-unavailable-market");
    expect(ids).toContain("system-mixed-data");
    expect(shell.notifications.find((n) => n.id === "data-unavailable-market")?.href).toBe(
      "/admin",
    );
    // Pages and matches are still searchable; no assets can be listed.
    expect(shell.commands.some((command) => command.href === "/admin")).toBe(true);
    expect(shell.commands.some((command) => command.group === "Assets")).toBe(false);
    expect(shell.commands.some((command) => command.group === "Matches")).toBe(true);
  });

  it("lets the public landing page render without its live preview", async () => {
    setMarketDataProviderForTesting(EMPTY_LICENSED);
    await expect(getLandingPreview()).resolves.toBeNull();
  });

  it("labels the demo configuration as synthetic", async () => {
    const shell = await getShellData();
    expect(shell.notifications.map((notification) => notification.id)).toContain(
      "system-demo-data",
    );
    const preview = await getLandingPreview();
    expect(preview?.sources).toEqual({
      markets: { simulated: true, name: expect.any(String) },
      sports: { simulated: true, name: expect.any(String) },
    });
  });
});
