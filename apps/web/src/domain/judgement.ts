// お手本ゾーン（重み付き分布）に対する判定とスコア。

import { METRICS, type MetricKey } from "./metrics";
import { isApproachGroup, type Approach, type ApproachGroup } from "./throws";

export type Zone = { p10: number; p25: number; p50: number; p75: number; p90: number };
export type Zones = Partial<Record<MetricKey, Zone>>;

/** お手本のゾーン一式：全部のお手本から作ったものと、投げ始めごとに作ったもの */
export type ZoneSet = { all: Zones; byApproach: Record<ApproachGroup, Zones> };

export const EMPTY_ZONE_SET: ZoneSet = { all: {}, byApproach: { drop: {}, standing: {} } };

/**
 * 投球の判定に使うゾーン。投げ始めで値の意味が変わる指標（byApproach）は、投げ始めが同じお手本のゾーンを使い、
 * 投げ始めが分からなければ判定しない。ほかの指標は全部のお手本のゾーンを使う
 */
export function zonesFor(set: ZoneSet, approach: Approach | undefined): Zones {
  const out: Zones = {};
  for (const d of METRICS) {
    const z = d.byApproach ? (isApproachGroup(approach) ? set.byApproach[approach][d.key] : undefined) : set.all[d.key];
    if (z) out[d.key] = z;
  }
  return out;
}
export type Status = "good" | "caution" | "flag" | "na";

export const STATUS_LABEL: Record<Status, string> = {
  good: "良好",
  caution: "注意",
  flag: "要改善",
  na: "判定不可",
};

/** 四分位の内側は良好、10〜90% は注意、その外は要改善 */
export function judge(value: number | undefined, zone: Zone | undefined): Status {
  if (value === undefined || zone === undefined) return "na";
  if (value >= zone.p25 && value <= zone.p75) return "good";
  if (value >= zone.p10 && value <= zone.p90) return "caution";
  return "flag";
}

/** 四分位範囲を 1 としたときの、四分位の外側への距離 */
export function deviation(value: number | undefined, zone: Zone | undefined) {
  if (value === undefined || !zone) return 0;
  const iqr = Math.max(1e-6, zone.p75 - zone.p25);
  if (value < zone.p25) return (zone.p25 - value) / iqr;
  if (value > zone.p75) return (value - zone.p75) / iqr;
  return 0;
}

/** 0〜100 の指標スコア。四分位の内側を満点とし、外れるほど下げる（下限 40） */
export function metricScore(value: number | undefined, zone: Zone | undefined): number | undefined {
  if (value === undefined || zone === undefined) return undefined;
  return Math.round(Math.max(40, 100 - 32 * deviation(value, zone)));
}

/** 1 指標の評価（自分の値・自己ベスト・お手本ゾーン・判定） */
export type MetricEvaluation = {
  key: MetricKey;
  value?: number;
  best?: number;
  zone?: Zone;
  status: Status;
  score?: number;
};

export function evaluateMetric(key: MetricKey, value: number | undefined, best: number | undefined, zone: Zone | undefined): MetricEvaluation {
  return { key, value, best, zone, status: judge(value, zone), score: metricScore(value, zone) };
}
