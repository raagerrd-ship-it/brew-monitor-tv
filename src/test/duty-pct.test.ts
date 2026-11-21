import { describe, expect, it } from "vitest";
import { toDutyPct, toRatePct } from "@/components/brew-card/utils";

describe("toDutyPct", () => {
  it("klämmer verkligt snapshotvärde 661.6 till 100 %", () => {
    expect(toDutyPct(661.6)).toBe(100);
  });
  it("rundar normala värden och tolkar null som 0", () => {
    expect(toDutyPct(38.8)).toBe(39);
    expect(toDutyPct(null)).toBe(0);
  });
});

describe("toRatePct", () => {
  it("skalar 0,010/dygn till 100 % och 0,005 till 50 %", () => {
    expect(toRatePct(0.01)).toBe(100);
    expect(toRatePct(0.005)).toBe(50);
  });
  it("klämmer över max och tolkar null som 0", () => {
    expect(toRatePct(0.02)).toBe(100);
    expect(toRatePct(null)).toBe(0);
  });
});
