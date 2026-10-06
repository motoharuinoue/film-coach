// ドリル動画：改善点に添える、練習ドリルを解説した YouTube の動画（の開始位置）。形は packages/schema の drill.v1 と同じ。
// 動画は取り込まず（ダウンロードしない）、YouTube のリンクか埋め込みで見る（ADR-0005）。
// どの指標を、どちら側（お手本の範囲より小さい／大きい）に外れたときに直すドリルかを持つ。指標は「大きいほど良い」ではないため。

import type { MetricKey } from "./metrics";

export type DrillSide = "low" | "high" | "any";

export const DRILL_SIDE_LABEL: Record<DrillSide, string> = { low: "お手本の範囲より小さいとき", high: "お手本の範囲より大きいとき", any: "どちらでも" };
export const DRILL_SIDE_SHORT: Record<DrillSide, string> = { low: "小さいとき", high: "大きいとき", any: "どちらでも" };

export type DrillTarget = { metric: MetricKey; side: DrillSide };

export type Drill = {
  id: string;
  youtubeId: string;
  title: string;
  channel: string;
  /** ドリルの説明が始まる位置（秒） */
  startSec: number;
  /** ドリルの名前 */
  label: string;
  targets: DrillTarget[];
  createdAt: string;
};

export type DrillInput = Omit<Drill, "id" | "createdAt">;

/** 解析サービスと同じ上限 */
export const DRILL_LIMITS = { label: 40, targets: 10 } as const;

/**
 * 改善点に添えるドリル：その指標の、外れた側を直すものを先に、どちらでもよいものをその次に選ぶ。同じなら新しく登録したもの
 */
export function pickDrill(drills: Drill[], key: MetricKey, side: "low" | "high"): Drill | undefined {
  const rank = (d: Drill) => {
    const t = d.targets.find((x) => x.metric === key);
    return !t ? 0 : t.side === side ? 2 : t.side === "any" ? 1 : 0;
  };
  return drills
    .filter((d) => rank(d) > 0)
    .sort((a, b) => rank(b) - rank(a) || b.createdAt.localeCompare(a.createdAt))[0];
}

/** YouTube で、ドリルの説明が始まる位置から開く URL */
export function drillUrl(d: Pick<Drill, "youtubeId" | "startSec">) {
  return `https://www.youtube.com/watch?v=${d.youtubeId}&t=${d.startSec}s`;
}
