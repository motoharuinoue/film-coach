// レップ・セッションの評価のユースケース。

import type { CameraAngle } from "../domain/camera";
import type { AnalyzedRep, BestRep, Session } from "../domain/entities";
import { evaluateMetric, zonesFor, type MetricEvaluation, type ZoneSet } from "../domain/judgement";
import { isValidFor, METRIC_BY_KEY, METRICS, type MetricKey, type RadarAxis } from "../domain/metrics";
import { releasePoint, releaseSpread } from "../domain/practice";
import { judgeMetrics } from "./judgeThrows";

// お手本ゾーンは、レップの投げ始めに合うものを使う（投げ始めで意味が変わる指標は、投げ始めが同じお手本だけ。zonesFor）

/** 各指標を、自分の値・自己ベスト・お手本ゾーンで評価する。カメラ角度で測れない指標は判定不可 */
export function evaluateRep(rep: AnalyzedRep, camera: CameraAngle, set: ZoneSet, best?: AnalyzedRep): MetricEvaluation[] {
  const zones = zonesFor(set, rep.approach);
  return METRICS.map((d) => evaluateMetric(d.key, isValidFor(d, camera) ? rep.metrics[d.key] : undefined, best?.metrics[d.key], zones[d.key], rep.uncertainty?.[d.key]));
}

/**
 * レップのスコア：判定できた指標のスコアの平均。「見る」・練習の画面の「お手本との一致」と同じ規則（judgeMetrics）で、
 * 判定できた指標が少ない（お手本が足りない など）ときは出さない（0 点にはしない）
 */
export function repScore(rep: AnalyzedRep, set: ZoneSet): number | undefined {
  return judgeMetrics(rep.metrics, zonesFor(set, rep.approach), rep.uncertainty).score;
}

/** 判定できる指標がこれより少ないセッション（試合映像など）はスコアを出さない */
export const MIN_METRICS_FOR_SCORE = 5;

/** セッションのスコア：スコアを出せたレップの平均。出せたレップがなければ出さない */
export function sessionScore(s: Session, set: ZoneSet): number | undefined {
  if (METRICS.filter((d) => isValidFor(d, s.camera)).length < MIN_METRICS_FOR_SCORE) return undefined;
  const scores = s.reps.map((r) => repScore(r, set)).filter((v): v is number => v !== undefined);
  return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : undefined;
}

/** 自己ベスト：対象セッションより前の、スコアを出せるセッションで最も高いレップ */
export function selectBestRep(sessions: Session[], excludeSessionId: string, set: ZoneSet): BestRep | undefined {
  let best: { rep: AnalyzedRep; s: Session; score: number } | undefined;
  for (const s of sessions) {
    if (s.id === excludeSessionId || sessionScore(s, set) === undefined) continue;
    for (const r of s.reps) {
      const score = repScore(r, set);
      if (score !== undefined && (!best || score > best.score)) best = { rep: r, s, score };
    }
  }
  return best && { ...best.rep, sessionId: best.s.id, date: best.s.date };
}

export function strengths(evals: MetricEvaluation[]): MetricKey[] {
  return evals.filter((e) => e.status === "good").map((e) => e.key);
}

// ---- 一貫性 ----

/** 各レップのリリース点（接地時の後ろ足からの前後位置と高さ、cm） */
export function releasePoints(s: Session) {
  return s.reps.map((r) => ({ id: r.id, ...releasePoint(r.seq, r.events) }));
}

/** リリース点のばらつき（cm）と、それを 0〜100 にしたスコア（4cm 以下が満点）。1 本だけならばらつきは 0 */
export function consistency(s: Session) {
  return releaseSpread(releasePoints(s)) ?? { spread: 0, score: 100 };
}

/** レーダーチャートの観点ごとのスコア。判定できる指標がない観点は undefined */
export function radarScores(evals: MetricEvaluation[], consistencyScore: number): Record<RadarAxis, number | undefined> {
  const axis = (a: RadarAxis) => {
    const xs = evals.filter((e) => METRIC_BY_KEY[e.key].axis === a && e.score !== undefined).map((e) => e.score!);
    return xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : undefined;
  };
  return {
    footwork: axis("footwork"),
    base: axis("base"),
    rotation: axis("rotation"),
    armPath: axis("armPath"),
    release: axis("release"),
    posture: axis("posture"),
    consistency: consistencyScore,
  };
}
