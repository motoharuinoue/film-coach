import { describe, expect, it } from "vitest";
import type { AnalyzedRep, Session } from "../domain/entities";
import type { ZoneSet, Zones } from "../domain/judgement";
import { evaluateRep, radarScores, repScore, selectBestRep, sessionScore } from "./evaluation";

const zoneValues: Zones = {
  strideRatio: { p10: 0.46, p25: 0.5, p50: 0.52, p75: 0.54, p90: 0.58 },
  frontKnee: { p10: 150, p25: 155, p50: 158, p75: 161, p90: 166 },
  elbowHeight: { p10: 5, p25: 8, p50: 10, p75: 12, p90: 15 },
  hipShoulderSep: { p10: 38, p25: 42, p50: 44, p75: 46, p90: 50 },
};
// 投げ始めで分けない指標だけなので、全部のお手本のゾーンで判定される
const zones: ZoneSet = { all: zoneValues, byApproach: { drop: {}, standing: {} } };
/** ステップ幅と、お手本ゾーンの中にある前膝角度・肘の高さを測ったレップ（スコアを出せる 3 指標） */
const rep = (id: string, strideRatio: number, extra: Partial<AnalyzedRep["metrics"]> = {}) => ({ id, index: 0, metrics: { strideRatio, frontKnee: 158, elbowHeight: 10, ...extra } }) as AnalyzedRep;
/** ステップ幅だけを測ったレップ（判定できる指標が足りない） */
const thin = (id: string, strideRatio: number) => ({ id, index: 0, metrics: { strideRatio } }) as AnalyzedRep;
const session = (id: string, camera: Session["camera"], reps: AnalyzedRep[]) => ({ id, date: `2026-09-0${id.slice(1)}`, camera, reps }) as Session;

describe("evaluateRep", () => {
  it("カメラ角度で測れない指標は、値があっても判定不可にする", () => {
    const evals = evaluateRep(rep("a", 0.52, { hipShoulderSep: 44 }), "side", zones);
    expect(evals.find((e) => e.key === "strideRatio")!.status).toBe("good");
    expect(evals.find((e) => e.key === "hipShoulderSep")!.status).toBe("na");
  });

  it("自己ベストの値を並べる", () => {
    const evals = evaluateRep(rep("a", 0.45), "side", zones, rep("best", 0.53));
    expect(evals.find((e) => e.key === "strideRatio")!.best).toBe(0.53);
  });
});

describe("repScore / sessionScore", () => {
  it("判定できた指標のスコアの平均", () => {
    expect(repScore(rep("a", 0.52), zones)).toBe(100);
  });

  it("判定できる指標が少ないカメラ角度のセッションはスコアを出さない", () => {
    expect(sessionScore(session("s1", "sideline", [rep("a", 0.52)]), zones)).toBeUndefined();
    expect(sessionScore(session("s2", "side", [rep("a", 0.52)]), zones)).toBe(100);
  });

  it("判定できた指標が 3 つに満たないレップには、スコアを出さない（0 点にしない）", () => {
    expect(repScore(thin("a", 0.52), zones)).toBeUndefined();
    // お手本がなく、お手本ゾーンがひとつもない
    expect(repScore(rep("b", 0.52), { all: {}, byApproach: { drop: {}, standing: {} } })).toBeUndefined();
  });

  it("セッションのスコアは、スコアを出せたレップだけの平均。出せたレップがなければ出さない", () => {
    expect(sessionScore(session("s1", "side", [rep("a", 0.52), thin("b", 0.3)]), zones)).toBe(100);
    expect(sessionScore(session("s2", "side", [thin("a", 0.52), thin("b", 0.52)]), zones)).toBeUndefined();
    expect(sessionScore(session("s3", "side", []), zones)).toBeUndefined();
  });
});

describe("selectBestRep", () => {
  it("除外したセッションとスコアを出せないセッションを除いて、最も高いレップを選ぶ", () => {
    const sessions = [session("s1", "side", [rep("old-a", 0.44), rep("old-b", 0.52)]), session("s2", "sideline", [rep("game", 0.52)]), session("s3", "side", [rep("now", 0.53)])];
    const best = selectBestRep(sessions, "s3", zones)!;
    expect(best.id).toBe("old-b");
    expect(best.sessionId).toBe("s1");
  });

  it("スコアを出せないレップは選ばない", () => {
    const sessions = [session("s1", "side", [thin("thin", 0.52), rep("low", 0.44)]), session("s2", "side", [rep("now", 0.53)])];
    expect(selectBestRep(sessions, "s2", zones)!.id).toBe("low");
    expect(selectBestRep([session("s1", "side", [thin("thin", 0.52)])], "s2", zones)).toBeUndefined();
  });
});

describe("radarScores", () => {
  it("判定できる指標がない観点は undefined、一貫性は渡した値", () => {
    const r = radarScores(evaluateRep(rep("a", 0.52), "side", zones), 88);
    expect(r.footwork).toBe(100);
    expect(r.posture).toBeUndefined();
    expect(r.consistency).toBe(88);
  });
});
