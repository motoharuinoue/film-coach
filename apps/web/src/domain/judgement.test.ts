import { describe, expect, it } from "vitest";
import { deviation, evaluateMetric, judge, metricScore, zonesFor, type Zone, type ZoneSet } from "./judgement";

const zone: Zone = { p10: 0.46, p25: 0.5, p50: 0.52, p75: 0.54, p90: 0.58 };

describe("judge", () => {
  it("四分位の内側は良好、10〜90% は注意、その外は要改善、値がなければ判定不可", () => {
    expect(judge(0.52, zone)).toBe("good");
    expect(judge(0.48, zone)).toBe("caution");
    expect(judge(0.44, zone)).toBe("flag");
    expect(judge(undefined, zone)).toBe("na");
    expect(judge(0.5, undefined)).toBe("na");
  });
});

describe("deviation / metricScore", () => {
  it("四分位の内側は外れ具合 0 で満点", () => {
    expect(deviation(0.53, zone)).toBe(0);
    expect(metricScore(0.53, zone)).toBe(100);
  });

  it("四分位範囲を 1 として外れ具合を測り、スコアは 40 点で止まる", () => {
    expect(deviation(0.46, zone)).toBeCloseTo(1);
    expect(metricScore(0.48, zone)!).toBeLessThan(100);
    expect(metricScore(0.1, zone)).toBe(40);
  });
});

describe("evaluateMetric", () => {
  it("値・自己ベスト・ゾーン・判定・スコアをまとめる", () => {
    expect(evaluateMetric("strideRatio", 0.52, 0.53, zone)).toEqual({ key: "strideRatio", value: 0.52, best: 0.53, zone, status: "good", score: 100 });
  });
});

describe("zonesFor", () => {
  const z = (p50: number): Zone => ({ p10: p50 - 2, p25: p50 - 1, p50, p75: p50 + 1, p90: p50 + 2 });
  const set: ZoneSet = {
    all: { strideRatio: z(0.5), headStability: z(3) },
    byApproach: { drop: { strideRatio: z(0.9), headStability: z(6) }, standing: { headStability: z(1) } },
  };

  it("投げ始めで意味が変わる指標（頭の上下動）は、投げ始めが同じお手本のゾーンを使う", () => {
    expect(zonesFor(set, "drop").headStability!.p50).toBe(6);
    expect(zonesFor(set, "standing").headStability!.p50).toBe(1);
  });

  it("投げ始めが分からなければ、その指標は判定しない。ほかの指標は全部のお手本のゾーンを使う", () => {
    expect(zonesFor(set, "unknown").headStability).toBeUndefined();
    expect(zonesFor(set, undefined).headStability).toBeUndefined();
    expect(zonesFor(set, "drop").strideRatio!.p50).toBe(0.5);
    expect(zonesFor(set, "unknown").strideRatio!.p50).toBe(0.5);
  });
});

describe("瞬間の時刻のずれで値が大きく変わるとき", () => {
  const z: Zone = { p10: 80, p25: 94, p50: 110, p75: 125, p90: 140 };

  it("値は残し、判定とスコアは出さない", () => {
    expect(evaluateMetric("elbowAngle", 155, undefined, z, 46)).toEqual({ key: "elbowAngle", value: 155, best: undefined, zone: z, status: "na", uncertainty: 46, imprecise: true });
    expect(evaluateMetric("elbowAngle", 155, undefined, z, 4)).toMatchObject({ status: "flag", uncertainty: 4 });
  });
});
