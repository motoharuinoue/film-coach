// お手本の重み付けのユースケース。お手本のレップを 1 標本ずつ重み付けし、
// お手本ごとの内訳はレップの平均で返す。

import type { Reference } from "../domain/entities";
import type { ZoneSet, Zones } from "../domain/judgement";
import { METRICS, type MetricKey } from "../domain/metrics";
import { APPROACH_GROUPS, type ApproachGroup } from "../domain/throws";
import { computeWeights, type ManualAdjust, type WeightParts } from "../domain/weighting";

export type PartsByMetric = Partial<Record<MetricKey, WeightParts>>;

export type ReferenceWeights = {
  zones: Zones;
  /** お手本ごとの内訳（レップの平均） */
  parts: Record<string, PartsByMetric>;
  /** お手本ごとの代表重み（有効な指標の平均） */
  overall: Record<string, number>;
  /** レップ（標本）ごとの内訳 */
  samples: Record<string, PartsByMetric>;
};

export const NEUTRAL_MANUAL: ManualAdjust = { pinned: false, excluded: false, stars: 3 };

export function defaultManual(refs: Reference[]): Record<string, ManualAdjust> {
  return Object.fromEntries(refs.map((r) => [r.id, NEUTRAL_MANUAL]));
}

export function weighReferences(refs: Reference[], manual: Record<string, ManualAdjust>): ReferenceWeights {
  const result = computeWeights(
    refs.flatMap((r) =>
      r.reps.map((rep) => ({
        id: rep.id,
        stats: r.stats,
        manual: manual[r.id] ?? NEUTRAL_MANUAL,
        metrics: rep.metrics,
      })),
    ),
  );
  const parts: Record<string, PartsByMetric> = {};
  const overall: Record<string, number> = {};
  for (const r of refs) {
    const ids = r.reps.map((rep) => rep.id);
    parts[r.id] = {};
    for (const def of METRICS) {
      const ps = ids.map((id) => result.parts[id]?.[def.key]).filter((p): p is WeightParts => p !== undefined);
      if (!ps.length) continue;
      const avg = (k: keyof WeightParts) => ps.reduce((a, p) => a + p[k], 0) / ps.length;
      parts[r.id]![def.key] = { P: avg("P"), C: avg("C"), Q: avg("Q"), K: avg("K"), M: avg("M"), w: avg("w") };
    }
    overall[r.id] = ids.reduce((a, id) => a + (result.overall[id] ?? 0), 0) / Math.max(1, ids.length);
  }
  return { zones: result.zones, parts, overall, samples: result.parts };
}

/**
 * 投げ始めごとの重みと分布。投げ始めが同じレップだけで重み付けする（合意度 K も、同じ投げ始めの中で見る）。
 * 投げ始めの分からないレップと、デモの合成データ（投げ始めを持たない）は入らない
 */
export function weighByApproach(refs: Reference[], manual: Record<string, ManualAdjust>): Record<ApproachGroup, ReferenceWeights> {
  const of = (g: ApproachGroup) =>
    weighReferences(
      refs.map((r) => ({ ...r, reps: r.reps.filter((rep) => rep.approach === g) })).filter((r) => r.reps.length > 0),
      manual,
    );
  return { drop: of("drop"), standing: of("standing") };
}

/** 判定に使うゾーン一式（全部のお手本と、投げ始めごと） */
export function zoneSetOf(all: ReferenceWeights, byApproach: Record<ApproachGroup, ReferenceWeights>): ZoneSet {
  return { all: all.zones, byApproach: Object.fromEntries(APPROACH_GROUPS.map((g) => [g, byApproach[g].zones])) as ZoneSet["byApproach"] };
}
