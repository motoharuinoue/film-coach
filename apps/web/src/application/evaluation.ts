// レップ・セッションの評価のユースケース。

import type { CameraAngle } from "../domain/camera";
import type { AnalyzedRep, BestRep, Session } from "../domain/entities";
import { evaluateMetric, type MetricEvaluation, type Zones } from "../domain/judgement";
import { isValidFor, METRIC_BY_KEY, METRICS, type MetricKey, type RadarAxis } from "../domain/metrics";
import { releasePoint, releaseSpread } from "../domain/practice";

/** 各指標を、自分の値・自己ベスト・お手本ゾーンで評価する。カメラ角度で測れない指標は判定不可 */
export function evaluateRep(rep: AnalyzedRep, camera: CameraAngle, zones: Zones, best?: AnalyzedRep): MetricEvaluation[] {
  return METRICS.map((d) => evaluateMetric(d.key, isValidFor(d, camera) ? rep.metrics[d.key] : undefined, best?.metrics[d.key], zones[d.key]));
}

/** レップのスコア：判定できた指標のスコアの平均 */
export function repScore(rep: AnalyzedRep, zones: Zones) {
  const scores = METRICS.map((d) => evaluateMetric(d.key, rep.metrics[d.key], undefined, zones[d.key]).score).filter((v): v is number => v !== undefined);
  return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
}

/** 判定できる指標がこれより少ないセッション（試合映像など）はスコアを出さない */
export const MIN_METRICS_FOR_SCORE = 5;

export function sessionScore(s: Session, zones: Zones): number | undefined {
  if (METRICS.filter((d) => isValidFor(d, s.camera)).length < MIN_METRICS_FOR_SCORE) return undefined;
  return Math.round(s.reps.reduce((a, r) => a + repScore(r, zones), 0) / s.reps.length);
}

/** 自己ベスト：対象セッションより前の、スコアを出せるセッションで最も高いレップ */
export function selectBestRep(sessions: Session[], excludeSessionId: string, zones: Zones): BestRep | undefined {
  let best: { rep: AnalyzedRep; s: Session; score: number } | undefined;
  for (const s of sessions) {
    if (s.id === excludeSessionId || sessionScore(s, zones) === undefined) continue;
    for (const r of s.reps) {
      const score = repScore(r, zones);
      if (!best || score > best.score) best = { rep: r, s, score };
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
