import { describe, expect, it } from "vitest";
import { chillerVisibility, chillerTitle, fmtC, fmtEta, fmtTarget, fmtRate, type ChillerSession } from "@/lib/chiller-session";

const now = Date.parse("2026-11-14T17:00:00Z");
const base: ChillerSession = {
  kind: "test", active: false, level: null, advice: null, started_at: null, ends_by: null, ended_at: null,
  bath_c: null, bath_from_c: null, stop_c: null, rate_c_min: null, eta_at: null, compressor_on: false,
  after_runs_done: null, lift_pct: null, result: null, chiller_locked: false, warnings: [], sent_at: null,
  updated_at: new Date(now).toISOString(),
};
const ago = (ms: number) => new Date(now - ms).toISOString();

describe("chillerVisibility", () => {
  it("visar aktiv session uppdaterad för under 5 min sedan", () => {
    expect(chillerVisibility({ ...base, active: true, updated_at: ago(4 * 60_000) }, now).visible).toBe(true);
  });
  it("döljer aktiv session när Pi:n varit tyst över 5 min", () => {
    expect(chillerVisibility({ ...base, active: true, updated_at: ago(6 * 60_000) }, now).visible).toBe(false);
  });
  it("visar avslutad session inom 60 min", () => {
    expect(chillerVisibility({ ...base, ended_at: ago(59 * 60_000), updated_at: ago(59 * 60_000) }, now).visible).toBe(true);
  });
  it("döljer avslutad session efter 60 min", () => {
    expect(chillerVisibility({ ...base, ended_at: ago(61 * 60_000) }, now).visible).toBe(false);
  });
  it("visar varningar även utan session", () => {
    expect(chillerVisibility({ ...base, kind: null, warnings: ["Kompressorn går varm"], updated_at: ago(3 * 3600_000) }, now).visible).toBe(true);
  });
  it("döljer när inget pågår", () => {
    expect(chillerVisibility(base, now).visible).toBe(false);
    expect(chillerVisibility(null, now).visible).toBe(false);
  });
});

describe("formatering", () => {
  it("rubriker efter kind", () => {
    expect([chillerTitle("test"), chillerTitle("refill"), chillerTitle("top"), chillerTitle(null)])
      .toEqual(["Gastest", "Påfyllning", "Toppning", "Glykolkylaren"]);
  });
  it("svensk decimalkomma och takt", () => {
    expect(fmtC(-3.25)).toBe("−3,3");
    expect(fmtRate(-0.12)).toBe("−0,12 °/min");
  });
  it("mål utan decimal vid hela grader", () => {
    expect(fmtTarget(0)).toBe("0");
    expect(fmtTarget(17.2)).toBe("17,2");
    expect(fmtTarget(-2)).toBe("−2");
  });
  it("ETA i svensk tid", () => {
    expect(fmtEta("2026-11-14T17:24:00Z")).toBe("18:24");
    expect(fmtEta("2026-07-14T17:24:00Z")).toBe("19:24");
  });
});
