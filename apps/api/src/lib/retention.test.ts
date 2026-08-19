import { describe, expect, it } from "vitest";
import { RETENTION_YEARS, retainUntilFrom } from "./retention";

describe("retention period", () => {
  it("is the five years Nigerian AML law requires", () => {
    expect(RETENTION_YEARS).toBe(5);
  });

  it("runs five years from closure", () => {
    const closed = new Date("2026-08-03T12:00:00Z");
    expect(retainUntilFrom(closed).toISOString()).toBe("2031-08-03T12:00:00.000Z");
  });

  it("does not mutate the date it is given", () => {
    const closed = new Date("2026-08-03T12:00:00Z");
    retainUntilFrom(closed);
    expect(closed.toISOString()).toBe("2026-08-03T12:00:00.000Z");
  });

  it("handles a leap day without landing on an invalid date", () => {
    // 29 Feb 2028 + 5 years is not a leap year; JS rolls to 1 March, which is
    // correct and, more importantly, still a real date.
    const closed = new Date("2028-02-29T00:00:00Z");
    const until = retainUntilFrom(closed);
    expect(Number.isNaN(until.getTime())).toBe(false);
    expect(until.getUTCFullYear()).toBe(2033);
  });
});
