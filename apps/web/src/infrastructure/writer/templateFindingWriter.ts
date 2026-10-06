// FindingWriter のテンプレート実装。数値は判定結果（MetricEvaluation）からだけ取る（ADR-0003）。
// 指標は「大きいほど良い」ではない（ステップ幅は広すぎても狭すぎても、リリース点も高すぎても良くない）。
// 文章は、値がお手本ゾーンのどちら側に外れたかで書き分け、範囲との関係で説明する。

import type { FindingWriter } from "../../application/ports";
import type { MetricEvaluation } from "../../domain/judgement";
import { METRIC_BY_KEY } from "../../domain/metrics";

/** お手本ゾーン（四分位）のどちら側に外れているか。内側なら undefined */
function side(v: number, p25: number, p75: number): "low" | "high" | undefined {
  return v < p25 ? "low" : v > p75 ? "high" : undefined;
}

export class TemplateFindingWriter implements FindingWriter {
  write(e: MetricEvaluation): { title: string; body: string } {
    const d = METRIC_BY_KEY[e.key];
    const v = e.value!;
    const z = e.zone!;
    const range = `お手本ゾーン（${z.p25.toFixed(d.digits)}〜${z.p75.toFixed(d.digits)}${d.unit}）`;
    const s = side(v, z.p25, z.p75);
    // 自己ベストがあれば、比べる手がかりとして添える（良し悪しは範囲で決める）
    const best = e.best !== undefined ? `自己ベストのときは ${e.best.toFixed(d.digits)}${d.unit} でした。` : "";
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
              body: `リリースの瞬間の肘が肩のラインから ${Math.round(v)} cm で、${range}より高い位置にあります。腕の振りが窮屈になり、リリースの位置が安定しにくくなります。`,
            }
          : {
              title: "リリースで肘が下がっている",
              body: `リリースの瞬間の肘が肩のラインから ${Math.round(v)} cm で、${range}より低い位置にあります。ボールが横から出やすく、高さと回転が安定しません。`,
            };
      case "sequenceGap":
        return s === "high"
          ? {
              title: "骨盤と体幹の回転の間が空きすぎている",
              body: `骨盤と体幹の回転のピークの間隔が ${Math.round(v)} ms で、${range}より長くなっています。下半身で作った力が、体幹に伝わるまでに逃げやすくなります。`,
            }
          : {
              title: "骨盤と体幹が同時に回っている",
              body: `骨盤と体幹の回転のピークの間隔が ${Math.round(v)} ms で、${range}より短くなっています。下半身から順に力を伝えられていません。`,
            };
      default:
        return {
          title: `${d.short}がお手本の範囲より${s === "high" ? "大きい" : "小さい"}`,
          body: `${d.label}が ${v.toFixed(d.digits)}${d.unit} で、${range}より${s === "high" ? "大きく" : "小さく"}なっています。${best}大きいほど・小さいほど良いのではなく、この範囲に入るかを見ています。`,
        };
    }
  }
}
