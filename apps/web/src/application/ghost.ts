// ユースケース：自分の投球に重ねるお手本を選び、指標を並べる。
// 横から撮ったお手本だけを使う（後方・正面からでは、ワールド座標の横が投げる方向にならず、重ねられない）。除外したお手本は使わない。
// 投げ始めが同じお手本を先に、その中で重み（P×C×Q×K×M の代表値）の高い順に並べ、先頭を自動で選ぶ。

import type { AnalyzedRep, Reference } from "../domain/entities";
import { judge, type Status, type Zones } from "../domain/judgement";
import { METRICS, type MetricKey, type MetricValues } from "../domain/metrics";
import { isApproachGroup, type Approach } from "../domain/throws";
import type { ManualAdjust } from "../domain/weighting";

export type GhostCandidate = {
  ref: Reference;
  /** 重ねるレップ（投げ始めが同じものがあればそれ） */
  rep: AnalyzedRep;
  weight: number;
  sameApproach: boolean;
};

export function ghostCandidates(refs: Reference[], overall: Record<string, number>, manual: Record<string, ManualAdjust>, approach: Approach | undefined): GhostCandidate[] {
  const same = (rep: AnalyzedRep) => isApproachGroup(approach) && rep.approach === approach;
  return refs
    .filter((r) => r.stats.camera === "side" && !manual[r.id]?.excluded && r.reps.length > 0)
    .map((r) => {
      const rep = r.reps.find(same) ?? r.reps[0]!;
      return { ref: r, rep, weight: overall[r.id] ?? 0, sameApproach: same(rep) };
    })
    .sort((a, b) => Number(b.sameApproach) - Number(a.sameApproach) || b.weight - a.weight);
}

export type MetricRow = { key: MetricKey; self?: number; other?: number; diff?: number; status: Status };

/** 自分とお手本の指標を並べる。差は良し悪しではなく、判定は自分の値のお手本ゾーンでの位置で決める */
export function compareMetrics(self: MetricValues, other: MetricValues, zones: Zones): MetricRow[] {
  return METRICS.filter((d) => self[d.key] !== undefined || other[d.key] !== undefined).map((d) => {
    const s = self[d.key];
    const o = other[d.key];
    return { key: d.key, self: s, other: o, diff: s !== undefined && o !== undefined ? s - o : undefined, status: judge(s, zones[d.key]) };
  });
}
