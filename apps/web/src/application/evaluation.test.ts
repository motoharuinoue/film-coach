import { describe, expect, it } from "vitest";
import type { AnalyzedRep, Session } from "../domain/entities";
import type { Zones } from "../domain/judgement";
import { evaluateRep, radarScores, repScore, selectBestRep, sessionScore } from "./evaluation";

const zones: Zones = {
  strideRatio: { p10: 0.46, p25: 0.5, p50: 0.52, p75: 0.54, p90: 0.58 },
  hipShoulderSep: { p10: 38, p25: 42, p50: 44, p75: 46, p90: 50 },
};
const rep = (id: string, strideRatio: number, extra: Partial<AnalyzedRep["metrics"]> = {}) => ({ id, index: 0, metrics: { strideRatio, ...extra } }) as AnalyzedRep;
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
});

describe("selectBestRep", () => {
  it("除外したセッションとスコアを出せないセッションを除いて、最も高いレップを選ぶ", () => {
    const sessions = [session("s1", "side", [rep("old-a", 0.44), rep("old-b", 0.52)]), session("s2", "sideline", [rep("game", 0.52)]), session("s3", "side", [rep("now", 0.53)])];
    const best = selectBestRep(sessions, "s3", zones)!;
    expect(best.id).toBe("old-b");
    expect(best.sessionId).toBe("s1");
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
