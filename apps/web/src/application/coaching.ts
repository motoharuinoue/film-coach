// 改善点を組み立てるユースケース：ドメインの方針で選び、文章はポートに任せ、ドリルを紐付ける。

import { pickFindings } from "../domain/coaching";
import type { AnalyzedRep } from "../domain/entities";
import { outside, type MetricEvaluation } from "../domain/judgement";
import { METRIC_BY_KEY, type MetricKey, unitSuffix } from "../domain/metrics";
import type { DrillPick, FindingWriter, ReferenceRepository } from "./ports";

export type Finding = {
  key: MetricKey;
  severity: "flag" | "caution";
  title: string;
  body: string;
  /** 目標（お手本ゾーンの四分位の範囲） */
  target: string;
  drill?: DrillPick;
  /** 根拠のフレーム */
  frame: number;
  /** 判定結果（LLM で文章にするときの材料） */
  evaluation: MetricEvaluation;
};

export function buildFindings(rep: AnalyzedRep, evals: MetricEvaluation[], writer: FindingWriter, references: ReferenceRepository, max = 3): Finding[] {
  return pickFindings(evals, max).map((e) => {
    const d = METRIC_BY_KEY[e.key];
    // 改善点は注意・要改善なので、値は必ずお手本ゾーンの外にある
    const drill = references.drillFor(e.key, outside(e.value, e.zone) ?? "low");
    return {
      key: e.key,
      severity: e.status as Finding["severity"],
      ...writer.write(e),
      target: `${e.zone!.p25.toFixed(d.digits)}〜${e.zone!.p75.toFixed(d.digits)}${unitSuffix(d.unit)}`,
      drill,
      frame: d.at === "range" ? rep.events.setStart : rep.events[d.at],
      evaluation: e,
    };
  });
}
