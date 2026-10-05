import { describe, expect, it } from "vitest";
import { deviation, evaluateMetric, judge, metricScore, type Zone } from "./judgement";

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
