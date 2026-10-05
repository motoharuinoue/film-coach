// 改善点の選び方（コーチングの方針）。

import { deviation, type MetricEvaluation } from "./judgement";
import { METRIC_BY_KEY, type RadarAxis } from "./metrics";

/**
 * 改善点を選ぶ：注意・要改善のうち、お手本ゾーンからの外れ具合が大きい順に、
 * 同じ観点（レーダーの軸）からは 1 つだけ選ぶ。似た指摘が並ばないようにするため。
 */
export function pickFindings(evals: MetricEvaluation[], max = 3): MetricEvaluation[] {
  const seen = new Set<RadarAxis>();
  return evals
    .filter((e) => e.status === "flag" || e.status === "caution")
    .sort((a, b) => deviation(b.value, b.zone) - deviation(a.value, a.zone))
    .filter((e) => {
      const axis = METRIC_BY_KEY[e.key].axis;
      if (seen.has(axis)) return false;
      seen.add(axis);
      return true;
    })
    .slice(0, max);
}
