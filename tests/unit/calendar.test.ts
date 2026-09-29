import { describe, expect, it } from "vitest";

import { getUsMarketSession, sessionCloseAt, WEEKDAY_CALENDAR } from "@/lib/clock";
import {
  easterSunday,
  isNyseTradingDay,
  NYSE_CALENDAR,
  nyseEarlyCloses,
  nyseHolidayName,
  nyseHolidays,
  tradingSessionsAfter,
} from "@/lib/markets/calendar";

const dates = (year: number) => nyseHolidays(year).map((holiday) => holiday.date);

describe("NYSE holiday calendar", () => {
  // Published NYSE Group holiday calendars.
  it.each([
    [
      2024,
      [
        "2024-01-01",
        "2024-01-15",
        "2024-02-19",
        "2024-03-29",
        "2024-05-27",
        "2024-06-19",
        "2024-07-04",
        "2024-09-02",
        "2024-11-28",
        "2024-12-25",
      ],
    ],
    [
      2025,
      [
        "2025-01-01",
        "2025-01-09",
        "2025-01-20",
        "2025-02-17",
        "2025-04-18",
        "2025-05-26",
        "2025-06-19",
        "2025-07-04",
        "2025-09-01",
        "2025-11-27",
        "2025-12-25",
      ],
    ],
    [
      2026,
      [
        "2026-01-01",
        "2026-01-19",
        "2026-02-16",
        "2026-04-03",
        "2026-05-25",
        "2026-06-19",
        "2026-07-03",
        "2026-09-07",
        "2026-11-26",
        "2026-12-25",
      ],
    ],
    [
      2027,
      [
        "2027-01-01",
        "2027-01-18",
        "2027-02-15",
        "2027-03-26",
        "2027-05-31",
        "2027-06-18",
        "2027-07-05",
        "2027-09-06",
        "2027-11-25",
        "2027-12-24",
      ],
    ],
  ])("matches the published %i holidays", (year, expected) => {
    expect(dates(year)).toEqual(expected);
  });

  it("does not observe New Year's Day on the preceding Friday", () => {
    // 1 January 2028 and 2022 are Saturdays: the market is open on 31 December.
    expect(isNyseTradingDay("2027-12-31")).toBe(true);
    expect(isNyseTradingDay("2021-12-31")).toBe(true);
    expect(dates(2028)).not.toContain("2027-12-31");
    expect(dates(2028)[0]).toBe("2028-01-17");
  });

  it("only observes Juneteenth from 2022", () => {
    expect(nyseHolidayName("2021-06-18")).toBeNull();
    expect(nyseHolidayName("2022-06-20")).toBe("Juneteenth");
  });

  it("computes Easter for known years", () => {
    expect(["2024", "2025", "2026", "2027", "2028"].map((y) => easterSunday(Number(y)))).toEqual([
      "2024-03-31",
      "2025-04-20",
      "2026-04-05",
      "2027-03-28",
      "2028-04-16",
    ]);
  });

  it("schedules 13:00 early closes only on trading days", () => {
    expect(nyseEarlyCloses(2024)).toEqual(["2024-07-03", "2024-11-29", "2024-12-24"]);
    expect(nyseEarlyCloses(2025)).toEqual(["2025-07-03", "2025-11-28", "2025-12-24"]);
    // 3 July 2026 is the observed Independence Day holiday.
    expect(nyseEarlyCloses(2026)).toEqual(["2026-11-27", "2026-12-24"]);
    // 3 July 2027 is a Saturday and 24 December 2027 the observed Christmas holiday.
    expect(nyseEarlyCloses(2027)).toEqual(["2027-11-26"]);
  });

  it("includes unscheduled closures", () => {
    expect(nyseHolidayName("2025-01-09")).toMatch(/Carter/);
    expect(isNyseTradingDay("2012-10-29")).toBe(false);
  });
});

describe("exchange-aware sessions", () => {
  it("reports holidays as closed and points at the previous session", () => {
    // Good Friday 2026, 15:00 UTC.
    const session = getUsMarketSession(new Date("2026-04-03T15:00:00Z"), NYSE_CALENDAR);
    expect(session.status).toBe("closed");
    expect(session.isTradingDay).toBe(false);
    expect(session.lastCompletedDate).toBe("2026-04-02");
    // The weekday calendar used by the demo market is unchanged.
    expect(getUsMarketSession(new Date("2026-04-03T15:00:00Z")).status).toBe("open");
  });

  it("skips holidays when finding the last completed session before the open", () => {
    // Tuesday after Memorial Day 2026, 08:00 New York.
    const session = getUsMarketSession(new Date("2026-05-26T12:00:00Z"), NYSE_CALENDAR);
    expect(session.status).toBe("pre-market");
    expect(session.lastCompletedDate).toBe("2026-05-22");
  });

  it("closes at 13:00 New York on early-close days", () => {
    // Day after Thanksgiving 2026 (EST, UTC−5): 13:30 New York is after the early close.
    const after = getUsMarketSession(new Date("2026-11-27T18:30:00Z"), NYSE_CALENDAR);
    expect(after.status).toBe("closed");
    expect(after.lastCompletedDate).toBe("2026-11-27");
    expect(after.closeAt.toISOString()).toBe("2026-11-27T18:00:00.000Z");
    const during = getUsMarketSession(new Date("2026-11-27T17:30:00Z"), NYSE_CALENDAR);
    expect(during.status).toBe("open");
  });

  it("locates session closes in UTC across daylight saving time", () => {
    expect(sessionCloseAt("2026-07-15", NYSE_CALENDAR).toISOString()).toBe(
      "2026-07-15T20:00:00.000Z",
    );
    expect(sessionCloseAt("2026-12-15", NYSE_CALENDAR).toISOString()).toBe(
      "2026-12-15T21:00:00.000Z",
    );
    expect(sessionCloseAt("2026-12-24", NYSE_CALENDAR).toISOString()).toBe(
      "2026-12-24T18:00:00.000Z",
    );
    expect(sessionCloseAt("2026-12-24", WEEKDAY_CALENDAR).toISOString()).toBe(
      "2026-12-24T21:00:00.000Z",
    );
  });

  it("counts trading sessions between dates", () => {
    // Thu 2 Apr 2026 → Tue 7 Apr 2026 spans Good Friday and a weekend: Mon 6 and Tue 7 trade.
    expect(tradingSessionsAfter(NYSE_CALENDAR, "2026-04-02", "2026-04-07")).toBe(2);
    expect(tradingSessionsAfter(NYSE_CALENDAR, "2026-04-07", "2026-04-02")).toBe(0);
  });
});
