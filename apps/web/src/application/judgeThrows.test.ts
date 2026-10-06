import { describe, expect, it } from "vitest";
import type { Zones } from "../domain/judgement";
import { judgeMetrics, MIN_JUDGED_FOR_SCORE, statusOf } from "./judgeThrows";

const zones: Zones = {
  strideRatio: { p10: 0.38, p25: 0.42, p50: 0.45, p75: 0.48, p90: 0.52 },
  frontKnee: { p10: 140, p25: 148, p50: 155, p75: 162, p90: 170 },
  elbowAngle: { p10: 90, p25: 100, p50: 110, p75: 120, p90: 130 },
};

describe("自分の投球をお手本の分布で判定する", () => {
  it("四分位の内側は良好、10〜90% は注意、その外は要改善。ゾーンのない指標は判定不可", () => {
    const j = judgeMetrics({ strideRatio: 0.45, frontKnee: 145, elbowAngle: 160, releaseTime: 0.5 }, zones);
    expect(j.evals.map((e) => [e.key, e.status])).toEqual([
      ["releaseTime", "na"],
      ["strideRatio", "good"],
      ["frontKnee", "caution"],
      ["elbowAngle", "flag"],
    ]);
    expect(j.judged).toBe(3);
    expect(j.score).toBeGreaterThan(40);
    expect(j.score).toBeLessThan(100);
  });

  it(`判定できた指標が ${MIN_JUDGED_FOR_SCORE} 個に満たなければ、スコアは出さない`, () => {
    expect(judgeMetrics({ strideRatio: 0.45, frontKnee: 150 }, zones).score).toBeUndefined();
    expect(judgeMetrics({ strideRatio: 0.45 }, {}).judged).toBe(0);
  });

  it("表の色分けには、値ごとの判定を使う", () => {
    expect([statusOf("strideRatio", 0.45, zones), statusOf("strideRatio", 0.6, zones), statusOf("headStability", 2, zones)]).toEqual(["good", "flag", "na"]);
  });
});
