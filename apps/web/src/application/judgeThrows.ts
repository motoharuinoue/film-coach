// ユースケース：自分の投球の指標を、手元のお手本の分布（お手本ゾーン）で判定する。
// 判定とスコアの規則はデモと同じ（domain/judgement.ts）。基準だけを、手元のお手本から作ったゾーンに替える。

import { evaluateMetric, judge, zonesFor, type MetricEvaluation, type Status, type ZoneSet, type Zones } from "../domain/judgement";
import { METRICS, type MetricDef, type MetricKey, type MetricValues } from "../domain/metrics";
import { APPROACH_LABEL, isApproachGroup, type Approach, type ThrowRep } from "../domain/throws";

/** 投球のスコアを出すのに要る、判定できた指標の数 */
export const MIN_JUDGED_FOR_SCORE = 3;

export type ThrowJudgement = {
  /** 測れた指標ごとの評価（ゾーンがなければ status は na） */
  evals: MetricEvaluation[];
  /** 判定できた指標のスコアの平均（MIN_JUDGED_FOR_SCORE 未満なら undefined） */
  score?: number;
  judged: number;
};

export function judgeMetrics(metrics: MetricValues, zones: Zones): ThrowJudgement {
  const evals = METRICS.filter((d) => metrics[d.key] !== undefined).map((d) => evaluateMetric(d.key, metrics[d.key], undefined, zones[d.key]));
  const scores = evals.map((e) => e.score).filter((s): s is number => s !== undefined);
  return {
    evals,
    score: scores.length >= MIN_JUDGED_FOR_SCORE ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : undefined,
    judged: scores.length,
  };
}

/** 値ごとの判定（表の色分け用） */
export function statusOf(key: MetricKey, value: number | undefined, zones: Zones): Status {
  return judge(value, zones[key]);
}

/** 1 本の投球を、その投げ始めに合うゾーンで判定する */
export function judgeRep(rep: Pick<ThrowRep, "metrics" | "approach">, set: ZoneSet): ThrowJudgement {
  return judgeMetrics(rep.metrics, zonesFor(set, rep.approach?.kind));
}

/** お手本ゾーンがなくて判定できない理由 */
export function noZoneReason(def: MetricDef, approach: Approach | undefined): string {
  if (!def.byApproach) return "この指標を測れるお手本が 2 本以上必要です";
  if (!isApproachGroup(approach)) return "投げ始め（ドロップの有無）が分からないので判定しません。投げ始めを指定して計算し直せます";
  return `投げ始めが同じ（${APPROACH_LABEL[approach]}）お手本で、この指標を測れたものが 2 本以上必要です`;
}
