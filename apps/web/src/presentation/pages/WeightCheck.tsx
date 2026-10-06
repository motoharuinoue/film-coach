// 重み付けの検証：重みの付け方を変えて、お手本ゾーンの揺れ（ブートストラップ）と、人気の高い外れ値によるずれを比べる（ADR-0006）。

import { IconLoader2 } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { validateReferences } from "../../application/references";
import { METRIC_BY_KEY, unitSuffix } from "../../domain/metrics";
import { SCHEME_LABEL, SCHEMES, type Scheme, type WeightValidation } from "../../domain/weightValidation";
import { Card, SectionTitle, Segmented, cx } from "../components/ui";
import type { LibraryView } from "../state/library";

const ITERATIONS = 1000;

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** 列でいちばん小さい値から、この差（1 ポイント）以内の値を強調する。わずかな差で順位を付けないように */
const NEAR_BEST = 0.01;
const nearBest = (row: Record<Scheme, number>, s: Scheme) => row[s] - Math.min(...SCHEMES.map((x) => row[x])) <= NEAR_BEST;

type Measure = "spread" | "shift0" | "shift1";

export function WeightCheck({ view }: { view: LibraryView }) {
  const [result, setResult] = useState<{ key: string; value: WeightValidation }>();
  const [measure, setMeasure] = useState<Measure>("spread");
  // お手本と手動調整が変わったら計算し直す。1,000 回の選び直しに数百ミリ秒かかるため、描画のあとに回す
  const key = `${view.source}:${view.refs.map((r) => r.id).join(",")}:${JSON.stringify(view.manual)}`;
  const latest = useRef(view);
  latest.current = view;
  useEffect(() => {
    const t = setTimeout(() => setResult({ key, value: validateReferences(latest.current.refs, latest.current.manual, { iterations: ITERATIONS }) }), 50);
    return () => clearTimeout(t);
  }, [key]);
  const v = result?.key === key ? result.value : undefined;

  const [near, far] = v?.outlierDistances ?? [1, 3];
  const columns: { key: Measure; label: string; sub: string; of: (m: { spread: Record<Scheme, number>; shift: Record<Scheme, number>[] }) => Record<Scheme, number> }[] = [
    { key: "spread", label: "ゾーンの揺れ", sub: `お手本を選び直す（${ITERATIONS.toLocaleString()} 回）`, of: (m) => m.spread },
    { key: "shift0", label: "外れ値によるずれ", sub: `値の幅 ${near} つ分外れた人気の動画`, of: (m) => m.shift[0]! },
    { key: "shift1", label: "外れ値によるずれ", sub: `値の幅 ${far} つ分外れた人気の動画`, of: (m) => m.shift[1]! },
  ];
  const detail = columns.find((c) => c.key === measure)!;

  return (
    <Card className="space-y-4 p-5" data-tour="references-validation">
      <SectionTitle>重み付けの検証</SectionTitle>
      <p className="max-w-3xl text-xs leading-relaxed text-muted">
        重みの付け方を変えて、お手本ゾーン（重み付き四分位）が「どのお手本を選んだか」と「人気の高い外れ値」でどれだけ動くかを比べます。値は、お手本の値の幅（最大 − 最小）に対する割合です。小さいほど、ゾーンが安定しています。
      </p>
      {!v ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <IconLoader2 size={15} className="animate-spin" aria-hidden /> 計算しています…
        </p>
      ) : v.metrics.length === 0 ? (
        <p className="text-sm text-muted">検証できる指標がありません。指標ごとに、測れたお手本が 3 本以上必要です。</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] text-muted">
                  <th className="py-2 pr-3 font-normal">重みの付け方</th>
                  {columns.map((c) => (
                    <th key={c.key} className="px-2 py-2 text-right font-normal">
                      <div>{c.label}</div>
                      <div className="text-[10px] text-faint">{c.sub}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SCHEMES.map((s) => (
                  <tr key={s} className="border-b border-line/60">
                    <td className="py-2 pr-3">
                      {SCHEME_LABEL[s]}
                      {s === "full" && <span className="ml-2 text-[10px] text-turf">採用</span>}
                    </td>
                    {columns.map((c) => {
                      const col = c.of(v.mean);
                      return (
                        <td key={c.key} className={cx("px-2 py-2 text-right font-mono", nearBest(col, s) ? "text-ice" : "text-muted")}>
                          {pct(col[s])}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-faint">{v.metrics.length} 指標の平均。青い値は、その列でいちばん小さい値と、そこから 1 ポイント以内の値です。</p>
          </div>

          <details className="group">
            <summary className="cursor-pointer text-xs text-muted hover:text-text">指標ごとの内訳</summary>
            <div className="mt-3 space-y-3">
              <Segmented label="表示する値" size="sm" value={measure} onChange={setMeasure} options={columns.map((c) => ({ value: c.key, label: c.key === "spread" ? "揺れ" : `ずれ（幅 ${c.key === "shift0" ? near : far} つ分）` }))} />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] text-muted">
                      <th className="py-2 pr-3 font-normal">指標</th>
                      <th className="px-2 py-2 text-right font-normal">お手本</th>
                      {SCHEMES.map((s) => (
                        <th key={s} className="px-2 py-2 text-right font-normal">
                          {SCHEME_LABEL[s]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {v.metrics.map((m) => {
                      const def = METRIC_BY_KEY[m.metric];
                      const row = detail.of(m);
                      return (
                        <tr key={m.metric} className="border-b border-line/60">
                          <td className="py-2 pr-3">
                            <div>{def.short}</div>
                            <div className="text-[10px] text-faint">
                              値の幅 {m.range.toFixed(def.digits)}
                              {unitSuffix(def.unit)}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-right text-muted">{m.groups} 本</td>
                          {SCHEMES.map((s) => (
                            <td key={s} className={cx("px-2 py-2 text-right font-mono", nearBest(row, s) ? "text-ice" : "text-muted")}>
                              {pct(row[s])}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </details>
        </>
      )}
      <ul className="list-disc space-y-1 pl-5 text-[11px] leading-relaxed text-faint">
        <li>ゾーンの揺れ：お手本の動画を、重複を許して同じ本数だけ選び直し、重みとゾーンを計算し直すことを {ITERATIONS.toLocaleString()} 回くり返します（ブートストラップ）。四分位（25・50・75%）の標準偏差の平均です。</li>
        <li>外れ値によるずれ：再生数 500 万回・登録者数 200 万人の動画が、既存のお手本の最大値よりさらに値の幅 {near} つ分（{far} つ分）大きい値を持つと仮定して加え、四分位が動いた量の平均を求めます。撮影の角度・画質・レップの数は、既存のお手本と同じにします。</li>
        <li>測れたお手本が 3 本未満の指標と、投げ始めごとに分布を作る指標（頭の上下動）は除きます。</li>
      </ul>
    </Card>
  );
}
