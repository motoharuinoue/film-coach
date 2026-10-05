// FindingWriter のテンプレート実装。数値は判定結果（MetricEvaluation）からだけ取る（ADR-0003）。

import type { FindingWriter } from "../../application/ports";
import type { MetricEvaluation } from "../../domain/judgement";
import { METRIC_BY_KEY } from "../../domain/metrics";

export class TemplateFindingWriter implements FindingWriter {
  write(e: MetricEvaluation): { title: string; body: string } {
    const d = METRIC_BY_KEY[e.key];
    const v = e.value!;
    const z = e.zone!;
    const pct = e.best ? Math.round(Math.abs(1 - v / e.best) * 100) : 0;
    switch (e.key) {
      case "strideRatio":
        return {
          title: "ステップ幅が狭い",
          body: `踏み出しが自己ベストより ${pct}% 狭く、前足の接地が早くなっています。下半身の回転を使い切る前に腕が出ています。`,
        };
      case "elbowHeight":
        return {
          title: "リリースで肘が下がっている",
          body: `リリースの瞬間の肘が、お手本ゾーンの中央より ${Math.abs(Math.round(v - z.p50))} cm 低い位置にあります。ボールが横から出やすく、高さと回転が安定しません。`,
        };
      case "sequenceGap":
        return {
          title: "骨盤と体幹が同時に回っている",
          body: `骨盤と体幹の回転のピークの間隔が ${Math.round(v)} ms しかありません。下半身から順に力を伝えられていません。ステップ幅が狭いことが原因の一つです。`,
        };
      default:
        return {
          title: `${d.short}が${v < z.p25 ? "小さい" : "大きい"}`,
          body: `${d.label}が ${v.toFixed(d.digits)}${d.unit} で、お手本ゾーン（${z.p25.toFixed(d.digits)}〜${z.p75.toFixed(d.digits)}${d.unit}）から外れています。`,
        };
    }
  }
}
