import { describe, expect, it } from "vitest";
import { pickFindings } from "./coaching";
import { evaluateMetric, type Zone } from "./judgement";

const z = (p50: number, iqr: number): Zone => ({ p10: p50 - iqr * 1.5, p25: p50 - iqr / 2, p50, p75: p50 + iqr / 2, p90: p50 + iqr * 1.5 });

describe("pickFindings", () => {
  const evals = [
    evaluateMetric("strideRatio", 0.4, undefined, z(0.52, 0.04)), // フットワーク、大きく外れる
    evaluateMetric("frontKnee", 172, undefined, z(158, 4)), // フットワーク、さらに大きく外れる
    evaluateMetric("elbowHeight", 10, undefined, z(15, 2)), // アームパス
    evaluateMetric("releaseTime", 0.33, undefined, z(0.33, 0.02)), // 良好
    evaluateMetric("hipShoulderSep", undefined, undefined, z(44, 4)), // 判定不可
  ];

  it("外れ具合の大きい順に、同じ観点からは 1 つだけ選ぶ", () => {
    expect(pickFindings(evals).map((e) => e.key)).toEqual(["frontKnee", "elbowHeight"]);
  });

  it("良好と判定不可は選ばない", () => {
    const keys = pickFindings(evals).map((e) => e.key);
    expect(keys).not.toContain("releaseTime");
    expect(keys).not.toContain("hipShoulderSep");
  });

  it("上限の数で打ち切る", () => {
    expect(pickFindings(evals, 1)).toHaveLength(1);
  });
});
