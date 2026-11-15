import { describe, expect, it } from "vitest";
import { chillerVisibility, chillerTitle, fmtC, fmtEta, fmtTarget, fmtRate, type ChillerSession } from "@/lib/chiller-session";
import { bathChartDomains, chartClock, chartLines, chartPath, chartScale, chartTicks, liftChartDomains, showLiftChart, type ChillerChart } from "@/lib/chiller-session";

const now = Date.parse("2026-11-14T17:00:00Z");
const base: ChillerSession = {
  kind: "test", active: false, level: null, advice: null, started_at: null, ends_by: null, ended_at: null,
  bath_c: null, bath_from_c: null, stop_c: null, rate_c_min: null, eta_at: null, compressor_on: false,
  after_runs_done: null, lift_pct: null, result: null, chiller_locked: false, warnings: [], sent_at: null,
  updated_at: new Date(now).toISOString(), chart: null,
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

describe("chiller chart", () => {
  const chart: ChillerChart = { series: [[0, 17.2, -4, null], [600, null, -6, null], [1200, 12, -8, null]], runs: [[0, 600]], lift: [[12, 30], [10, 40]], lift_base: [[14, 50], [0, 60]] };
  it("temperature scale includes sensors and stop target", () => {
    const { time, temperature } = bathChartDomains(chart, -10);
    expect(time).toEqual([0, 1200]);
    expect(temperature[0]).toBeLessThan(-10);
    expect(temperature[1]).toBeGreaterThan(17.2);
    expect(chartTicks(temperature)).toHaveLength(4);
  });
  it("only selects lines with measured values", () => {
    expect(chartLines(chart)).toEqual([1, 2]);
    expect(chartLines({ series: [[0, null, null, null]], runs: [] })).toEqual([]);
  });
  it("missing bath reading leaves a gap", () => {
    expect(chartPath([[0, 17], [600, null], [1200, 12]], (v) => v, (v) => v)).toBe("M0,17  M1200,12");
  });
  it("clock labels use start plus seconds in Swedish winter and summer time", () => {
    expect(chartClock("2026-11-15T09:00:00Z", 1200)).toBe("10:20");
    expect(chartClock("2026-07-15T09:00:00Z", 1200)).toBe("11:20");
  });
  it("warm degrees are left and zero right, ticks every two degrees", () => {
    const domain = liftChartDomains(chart, 17.2);
    expect(domain.degrees).toEqual([18, 0]);
    expect(domain.ticks).toEqual([18, 16, 14, 12, 10, 8, 6, 4, 2, 0]);
    expect(chartScale(18, domain.degrees, 36, 350)).toBe(36);
    expect(chartScale(0, domain.degrees, 36, 350)).toBe(350);
    expect(domain.heat).toEqual([0, 69]);
    expect(liftChartDomains({ series: [], runs: [] }, null).degrees).toEqual([12, 0]);
  });
  it("lift graph only for test, empty active test is shown, empty ended test is hidden", () => {
    const empty = { ...chart, lift: [] };
    expect(showLiftChart({ ...base, active: true, chart: empty })).toBe(true);
    expect(showLiftChart({ ...base, ended_at: ago(60_000), chart: empty })).toBe(false);
    expect(showLiftChart({ ...base, ended_at: ago(60_000), chart })).toBe(true);
    expect(showLiftChart({ ...base, active: true, chart }, true)).toBe(false);
    expect(showLiftChart({ ...base, kind: "top", active: true, chart })).toBe(false);
    expect(showLiftChart(base)).toBe(false);
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
