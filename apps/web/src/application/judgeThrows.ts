// ユースケース：自分の投球の指標を、手元のお手本の分布（お手本ゾーン）で判定する。
// 判定とスコアの規則はデモと同じ（domain/judgement.ts）。基準だけを、手元のお手本から作ったゾーンに替える。

import { evaluateMetric, judge, type MetricEvaluation, type Status, type Zones } from "../domain/judgement";
import { METRICS, type MetricKey, type MetricValues } from "../domain/metrics";

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
