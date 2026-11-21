import { describe, expect, it } from "vitest";
import { toDutyPct } from "@/components/brew-card/utils";

describe("toDutyPct", () => {
  it("klämmer verkligt snapshotvärde 661.6 till 100 %", () => {
    expect(toDutyPct(661.6)).toBe(100);
  });
  it("rundar normala värden och tolkar null som 0", () => {
    expect(toDutyPct(38.8)).toBe(39);
    expect(toDutyPct(null)).toBe(0);
  });
});
