import { describe, expect, it } from "vitest";
import { BrewData } from "@/types/brew";
import { gravityPanelData, tempScalePosition, tempIsOffTarget } from "@/components/brew-card/stat-panel-data";

const brew = {
  status: "Jäsning", originalGravity: 1.042, finalGravity: 1.008, currentSG: 1.020,
  sgData: [{ date: "2020-01-01", value: 1.042, temp: 19 }],
  fermentationRate: 0.004, fermentationTrend: { rate6h: 0.004 },
} as BrewData;

describe("B2 gravity", () => {
  it("visar fyra punkter per dygn och 24 h prognos från rate6h", () => {
    const result = gravityPanelData(brew);
    expect(result.pointsPerDay).toBe("4");
    expect(result.projected).toBeCloseTo(76.470588);
  });
  it("använder befintlig rate när rate6h saknas", () => {
    expect(gravityPanelData({ ...brew, fermentationTrend: undefined }).pointsPerDay).toBe("4");
  });
  it("visar en decimal med decimalkomma under en punkt per dygn", () => {
    const result = gravityPanelData({ ...brew, fermentationTrend: { rate6h: 0.0003, rate12h: 0.0003, trend: "falling" } });
    expect(result.pointsPerDay).toBe("0,3");
  });
  it("visar inte stall eller prognos före pitch", () => {
    const result = gravityPanelData({ ...brew, sgData: [], fermentationRate: 0 });
    expect(result.prePitch).toBe(true);
    expect(result.stalled).toBe(false);
    expect(result.projected).toBe(result.progress);
  });
  it("visar stall utan prognos", () => {
    const result = gravityPanelData({ ...brew, fermentationRate: 0.001 });
    expect(result.stalled).toBe(true);
    expect(result.projected).toBe(result.progress);
  });
  it("bevarar Pi:ns ready även för klar brygd", () => {
    const result = gravityPanelData({ ...brew, status: "Klar", fermentationMetrics: { ready_to_crash: true } as NonNullable<BrewData["fermentationMetrics"]> });
    expect(result.ready).toBe(true);
    expect(result.pointsPerDay).toBeNull();
  });
  it("visar inaktiv brygd som klar även när ready_to_crash är dold", () => {
    const result = gravityPanelData({ ...brew, status: "Klar" }, true);
    expect(result.ready).toBe(true);
    expect(result.done).toBe(true);
    expect(result.stalled).toBe(false);
    expect(result.pointsPerDay).toBeNull();
    expect(result.projected).toBe(result.progress);
  });
  it("visar ingen fart när den avrundas till noll punkter per dygn", () => {
    const result = gravityPanelData({ ...brew, fermentationTrend: { rate6h: 0.00004, rate12h: 0.00004, trend: "falling" } });
    expect(result.pointsPerDay).toBeNull();
    expect(result.projected).toBe(result.progress);
  });
});

describe("B2 temperaturskala mål ±3°", () => {
  it("markerar först när snittet avviker mer än 1°", () => {
    expect(tempIsOffTarget(18, 19)).toBe(false);
    expect(tempIsOffTarget(17.7, 19)).toBe(true);
    expect(tempIsOffTarget(20.1, 19)).toBe(true);
    expect(tempIsOffTarget(null, 19)).toBe(false);
  });
  it("placerar 16°, 19° och 22° vid 0, 50 och 100 procent", () => {
    expect(tempScalePosition(16, 19)).toBe(0);
    expect(tempScalePosition(19, 19)).toBe(50);
    expect(tempScalePosition(22, 19)).toBe(100);
    expect(tempScalePosition(30, 19)).toBe(100);
  });
});