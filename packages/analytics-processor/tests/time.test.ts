import { describe, expect, it } from "bun:test";

import {
  dayKey,
  hourKey,
  hoursBetween,
  maxWindowFor,
  monthKey,
  shiftAnchor,
  windowKeys,
  yearKey,
} from "../src/time.ts";

describe("time key formatting", () => {
  it("zero-pads single-digit month, day, and hour", () => {
    const date = new Date(Date.UTC(2026, 2, 4, 7));
    expect(yearKey(date)).toBe("2026");
    expect(monthKey(date)).toBe("2026-03");
    expect(dayKey(date)).toBe("2026-03-04");
    expect(hourKey(date)).toBe("2026-03-04-07");
  });

  it("formats double-digit components without extra padding", () => {
    const date = new Date(Date.UTC(2026, 10, 23, 18));
    expect(monthKey(date)).toBe("2026-11");
    expect(dayKey(date)).toBe("2026-11-23");
    expect(hourKey(date)).toBe("2026-11-23-18");
  });

  it("uses UTC, ignoring any local offset of the input instant", () => {
    const date = new Date("2026-02-14T09:00:00.000Z");
    expect(hourKey(date)).toBe("2026-02-14-09");
  });
});

describe("maxWindowFor", () => {
  it("returns the documented window ceilings per grain", () => {
    expect(maxWindowFor("hour")).toBe(24);
    expect(maxWindowFor("day")).toBe(30);
    expect(maxWindowFor("month")).toBe(12);
  });
});

describe("windowKeys", () => {
  it("spans a 24-hour hourly window crossing midnight", () => {
    const anchor = new Date(Date.UTC(2026, 1, 14, 9));
    const { startKey, endKey } = windowKeys({ grain: "hour", anchor, size: 24 });
    expect(endKey).toBe("2026-02-14-09");
    expect(startKey).toBe("2026-02-13-10");
  });

  it("returns a single bucket when size is 1", () => {
    const anchor = new Date(Date.UTC(2026, 1, 14, 9));
    const { startKey, endKey } = windowKeys({ grain: "hour", anchor, size: 1 });
    expect(startKey).toBe("2026-02-14-09");
    expect(endKey).toBe("2026-02-14-09");
  });

  it("spans a daily window crossing a month boundary", () => {
    const anchor = new Date(Date.UTC(2026, 2, 2, 0));
    const { startKey, endKey } = windowKeys({ grain: "day", anchor, size: 5 });
    expect(endKey).toBe("2026-03-02");
    expect(startKey).toBe("2026-02-26");
  });

  it("spans a monthly window crossing a year boundary", () => {
    const anchor = new Date(Date.UTC(2026, 1, 15, 0));
    const { startKey, endKey } = windowKeys({ grain: "month", anchor, size: 3 });
    expect(endKey).toBe("2026-02");
    expect(startKey).toBe("2025-12");
  });
});

describe("shiftAnchor", () => {
  it("shifts hourly anchors across a day boundary exactly", () => {
    const anchor = new Date(Date.UTC(2026, 1, 14, 2));
    const prev = shiftAnchor({ grain: "hour", anchor, size: 5, direction: "prev" });
    expect(hourKey(prev)).toBe("2026-02-13-21");
    const next = shiftAnchor({ grain: "hour", anchor, size: 24, direction: "next" });
    expect(hourKey(next)).toBe("2026-02-15-02");
  });

  it("shifts daily anchors across a month boundary exactly", () => {
    const anchor = new Date(Date.UTC(2026, 2, 3, 0));
    const prev = shiftAnchor({ grain: "day", anchor, size: 5, direction: "prev" });
    expect(dayKey(prev)).toBe("2026-02-26");
  });

  it("shifts a month anchor to the previous year exactly", () => {
    const anchor = new Date(Date.UTC(2026, 0, 15, 0));
    const prev = shiftAnchor({ grain: "month", anchor, size: 1, direction: "prev" });
    expect(monthKey(prev)).toBe("2025-12");
  });

  it("shifts a month anchor forward across a year boundary exactly", () => {
    const anchor = new Date(Date.UTC(2026, 10, 15, 0));
    const next = shiftAnchor({ grain: "month", anchor, size: 3, direction: "next" });
    expect(monthKey(next)).toBe("2027-02");
  });
});

describe("hoursBetween", () => {
  it("returns an inclusive list of hour keys across a day boundary", () => {
    const from = new Date(Date.UTC(2026, 1, 14, 22));
    const to = new Date(Date.UTC(2026, 1, 15, 1));
    expect(hoursBetween({ from, to })).toEqual([
      "2026-02-14-22",
      "2026-02-14-23",
      "2026-02-15-00",
      "2026-02-15-01",
    ]);
  });

  it("includes both endpoints and counts them", () => {
    const from = new Date(Date.UTC(2026, 1, 14, 0));
    const to = new Date(Date.UTC(2026, 1, 14, 23));
    const keys = hoursBetween({ from, to });
    expect(keys.length).toBe(24);
    expect(keys.at(0)).toBe("2026-02-14-00");
    expect(keys.at(-1)).toBe("2026-02-14-23");
  });

  it("returns a single key when from and to are the same hour", () => {
    const instant = new Date(Date.UTC(2026, 1, 14, 9, 30));
    expect(hoursBetween({ from: instant, to: instant })).toEqual(["2026-02-14-09"]);
  });
});
