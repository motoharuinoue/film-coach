import { describe, expect, it } from "vitest";
import type { ZoneSet, Zones } from "../domain/judgement";
import { METRIC_BY_KEY } from "../domain/metrics";
import { impreciseReason, judgeMetrics, judgeRep, MIN_JUDGED_FOR_SCORE, noZoneReason, statusOf } from "./judgeThrows";

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

describe("投げ始めをそろえて判定する", () => {
  const head = { p10: 4, p25: 5, p50: 6, p75: 7, p90: 8 };
  const set: ZoneSet = { all: { ...zones, headStability: { p10: 0, p25: 0.2, p50: 0.4, p75: 0.6, p90: 1 } }, byApproach: { drop: { headStability: head }, standing: {} } };
  const metrics = { strideRatio: 0.45, frontKnee: 150, elbowAngle: 110, headStability: 6.5 };

  it("ドロップからの投球の頭の上下動は、ドロップからのお手本とだけ比べる", () => {
    const j = judgeRep({ metrics, approach: { kind: "drop", dropM: 1.4 } }, set);
    expect(j.evals.find((e) => e.key === "headStability")).toMatchObject({ status: "good", zone: head });
    expect(j.judged).toBe(4);
  });

  it("投げ始めが分からない・同じ投げ始めのお手本がなければ、頭の上下動は判定しない", () => {
    for (const approach of [undefined, { kind: "unknown" as const, dropM: null }, { kind: "standing" as const, dropM: 0.1 }]) {
      const j = judgeRep({ metrics, approach }, set);
      expect(j.evals.find((e) => e.key === "headStability")!.status).toBe("na");
      expect(j.judged).toBe(3);
    }
  });

  it("判定できない理由を、投げ始めの有無で書き分ける", () => {
    expect(noZoneReason(METRIC_BY_KEY.strideRatio, "drop")).toBe("この指標を測れるお手本が 2 本以上必要です");
    expect(noZoneReason(METRIC_BY_KEY.headStability, "unknown")).toContain("投げ始め（ドロップの有無）が分からない");
    expect(noZoneReason(METRIC_BY_KEY.headStability, "standing")).toContain("投げ始めが同じ（その場から）お手本");
  });
});

describe("瞬間の時刻のずれで大きく変わる値", () => {
  it("判定せず、判定できた指標の数にも入れない", () => {
    const j = judgeMetrics({ strideRatio: 0.45, frontKnee: 150, elbowAngle: 160 }, zones, { strideRatio: 0.001, elbowAngle: 46 });
    expect(j.evals.find((e) => e.key === "elbowAngle")).toMatchObject({ status: "na", imprecise: true });
    expect(j.judged).toBe(2);
    expect(statusOf("elbowAngle", 160, zones, 46)).toBe("na");
  });

  it("理由に、変わり幅と、測れる fps の目安を添える", () => {
    expect(impreciseReason("elbowAngle", 46, 30)).toBe("リリースの瞬間の前後で ±46° 変わるため、判定しません（240 fps 以上で撮ると測れることがあります）");
    expect(impreciseReason("strideRatio", 0.05, 30)).toContain("接地の瞬間の前後で ±0.05 変わる");
    expect(impreciseReason("elbowAngle", 30, 240)).toContain("240 fps でも足りません");
  });
});
