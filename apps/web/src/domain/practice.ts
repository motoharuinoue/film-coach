// 練習（設計書のデータモデルの Session）：何本かの映像を 1 回の練習としてまとめ、投球を比べる単位。
// 形は packages/schema の practice.v1 と同じ。デモの Session（entities.ts、合成データ）とは別の、実際の映像のまとめ。

import type { CameraAngle } from "./camera";
import { METRICS, type MetricKey } from "./metrics";
import type { Events } from "./phases";
import { kp, type PoseSequence } from "./pose";
import type { ThrowAnalysis, ThrowRep } from "./throws";

export type PracticeKind = "drill" | "game";

export const PRACTICE_KIND_LABEL: Record<PracticeKind, string> = { drill: "ドリル", game: "試合" };

export type Practice = {
  id: string;
  name: string;
  /** 練習した日（YYYY-MM-DD） */
  date: string;
  kind: PracticeKind;
  camera: CameraAngle;
  memo: string;
  /** まとめた映像（並べる順） */
  videoIds: string[];
  createdAt: string;
};

export type PracticeInput = Omit<Practice, "id" | "createdAt">;

/** 解析サービスと同じ上限 */
export const PRACTICE_LIMITS = { name: 40, memo: 400, videos: 50 } as const;

/** 練習の中の 1 球（どの映像の何球目か） */
export type PracticeThrow = {
  /** 練習の中での通し番号（1 から） */
  order: number;
  footageId: string;
  footageName: string;
  fps: number;
  rep: ThrowRep;
};

/** 映像の並び順・映像の中の投球の順に、通し番号を付けて並べる */
export function collectThrows(entries: { id: string; name: string; analysis?: ThrowAnalysis }[]): PracticeThrow[] {
  const out: PracticeThrow[] = [];
  for (const e of entries) {
    for (const rep of e.analysis?.reps ?? []) out.push({ order: out.length + 1, footageId: e.id, footageName: e.name, fps: e.analysis!.video.fps, rep });
  }
  return out;
}

/** 1 つの指標の、投球ごとの値と、平均・幅・標準偏差 */
export type MetricSpread = { key: MetricKey; values: (number | undefined)[]; n: number; mean: number; min: number; max: number; sd: number };

const sdOf = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

/** 指標ごとの比較。どの投球でも測れなかった指標は入れない */
export function metricSpreads(throws: PracticeThrow[]): MetricSpread[] {
  return METRICS.flatMap((d) => {
    const values = throws.map((t) => t.rep.metrics[d.key]);
    const xs = values.filter((v): v is number => v !== undefined);
    if (!xs.length) return [];
    return [{ key: d.key, values, n: xs.length, mean: xs.reduce((a, b) => a + b, 0) / xs.length, min: Math.min(...xs), max: Math.max(...xs), sd: sdOf(xs) }];
  });
}

/** リリース点：接地時の後ろ足からの前後位置と、地面からの高さ（cm） */
export function releasePoint(seq: PoseSequence, e: Events) {
  const back = kp(seq.frames[e.plant]!, "rAnkle");
  const w = kp(seq.frames[e.release]!, "rWrist");
  return { x: (w.x - back.x) * 100, y: w.y * 100 };
}

/** リリース点のばらつき（cm）と、それを 0〜100 にしたスコア（4cm 以下が満点） */
export function releaseSpread(points: { x: number; y: number }[]) {
  if (points.length < 2) return undefined;
  const spread = Math.hypot(sdOf(points.map((p) => p.x)), sdOf(points.map((p) => p.y)));
  return { spread, score: Math.round(Math.max(40, Math.min(100, 100 - (spread - 4) * 6))) };
}
