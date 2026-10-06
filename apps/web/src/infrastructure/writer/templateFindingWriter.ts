// FindingWriter のテンプレート実装。数値は判定結果（MetricEvaluation）からだけ取る（ADR-0003）。
// 指標は「大きいほど良い」ではない（ステップ幅は広すぎても狭すぎても、リリース点も高すぎても良くない）。
// 文章は、値がお手本ゾーンのどちら側に外れたかで書き分け、範囲との関係で説明する。

import type { FindingWriter } from "../../application/ports";
import { outside, type MetricEvaluation } from "../../domain/judgement";
import { METRIC_BY_KEY, type MetricKey, unitSuffix } from "../../domain/metrics";

/** 汎用の文章での言い方。範囲より上・下を表す語（既定は「大きい・小さい」）と、呼び方を変える指標だけ */
const WORDING: Partial<Record<MetricKey, { title?: string; body?: string; high: string; low: string }>> = {
  releaseTime: { body: "始動からリリースまでの時間", high: "長い", low: "短い" },
  releaseHeight: { high: "高い", low: "低い" },
  // 値は頭の上下動の大きさ。「頭の安定が大きい」（＝安定している）と読めないように、上下動と書く
  headStability: { title: "頭の上下動", high: "大きい", low: "小さい" },
};

export class TemplateFindingWriter implements FindingWriter {
  write(e: MetricEvaluation): { title: string; body: string } {
    const d = METRIC_BY_KEY[e.key];
    const v = e.value!;
    const z = e.zone!;
    // 英字の単位（cm・ms・s）は数値との間に半角スペースを入れる（° は詰める）
    const unit = unitSuffix(d.unit);
    const num = (x: number) => `${x.toFixed(d.digits)}${unit}`;
    const range = `お手本ゾーン（${z.p25.toFixed(d.digits)}〜${num(z.p75)}）`;
    const s = outside(v, z);
    // 自己ベストがあれば、比べる手がかりとして添える（良し悪しは範囲で決める）
    const best = e.best !== undefined ? `自己ベストのときは ${num(e.best)} でした。` : "";
    switch (e.key) {
      case "strideRatio":
        return s === "high"
          ? {
              title: "ステップ幅がお手本の範囲より広い",
              body: `踏み出しが身長の ${v.toFixed(2)} 倍で、${range}より広くなっています。${best}踏み出しすぎると前足で体重を受け止めきれず、上体が突っ込んだりリリースがばらついたりしやすくなります。`,
            }
          : {
              title: "ステップ幅がお手本の範囲より狭い",
              body: `踏み出しが身長の ${v.toFixed(2)} 倍で、${range}より狭くなっています。${best}前足の接地が早く、下半身の回転を使い切る前に腕が出やすくなります。`,
            };
      case "elbowHeight":
        return s === "high"
          ? {
              title: "リリースで肘が上がりすぎている",
              body: `リリースの瞬間、肘の高さが肩のラインから ${Math.round(v)} cm で、${range}より高くなっています。腕の振りが窮屈になり、リリースの位置が安定しにくくなります。`,
            }
          : {
              title: "リリースで肘が下がっている",
              body: `リリースの瞬間、肘の高さが肩のラインから ${Math.round(v)} cm で、${range}より低くなっています。ボールが横から出やすく、高さと回転が安定しません。`,
            };
      case "sequenceGap":
        return s === "high"
          ? {
              title: "骨盤と体幹の回転の間が空きすぎている",
              body: `骨盤と体幹の回転ピークの間隔が ${Math.round(v)} ms で、${range}より長くなっています。下半身で作った力が、体幹に伝わるまでに逃げやすくなります。`,
            }
          : {
              title: "骨盤と体幹が同時に回っている",
              body: `骨盤と体幹の回転ピークの間隔が ${Math.round(v)} ms で、${range}より短くなっています。下半身から順に力を伝えられていません。`,
            };
      default: {
        const w = WORDING[e.key] ?? { high: "大きい", low: "小さい" };
        const word = s === "high" ? w.high : w.low;
        return {
          title: `${w.title ?? d.short}がお手本の範囲より${word}`,
          body: `${w.body ?? d.label}が ${num(v)} で、${range}より${word.replace(/い$/, "く")}なっています。${best}${w.high}ほど良い・${w.low}ほど良いというものではなく、この範囲に入るかどうかを見ています。`,
        };
      }
    }
  }
}
