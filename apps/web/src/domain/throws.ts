// 自分の映像から見つけた投球と、1 本ずつのフェーズ・QB 指標。
// 形は packages/schema の throw-analysis.v1 と同じ（読み込みは infrastructure/http）。
// フェーズと指標の位置は投球の区間の中のフレーム番号、start / end は映像のフレーム番号。

import type { CameraAngle } from "./camera";
import type { MetricKey, MetricValues } from "./metrics";
import { phaseAt, type Events, type Phase, type PhaseKey } from "./phases";
import type { PoseSequence } from "./pose";

export type ThrowHand = "right" | "left";

/** 画像の座標（カメラの動きを打ち消した座標）→ ワールド 2D の変換 */
export type WorldTransform = { mPerPx: number; originX: number; groundY: number; direction: 1 | -1; ankleM: number };

export type ThrowRep = {
  index: number;
  /** 映像のフレーム番号（区間の最初） */
  start: number;
  /** 映像のフレーム番号（区間の最後、含む） */
  end: number;
  transform: WorldTransform;
  events: Events;
  phases: Phase[];
  metrics: MetricValues;
  /** 平滑化した骨格（ワールド 2D、時刻は区間の最初が 0） */
  sequence: PoseSequence;
};

export type ThrowAnalysis = {
  video: { name: string; fps: number; width: number; height: number; frameCount: number };
  heightM: number;
  camera: CameraAngle;
  hand: ThrowHand;
  reps: ThrowRep[];
  /** 結果を読むときの注意（本人が小さく映っている、投球が見つからない など） */
  warnings: string[];
};

export type ThrowsRequest = { heightCm: number; camera: CameraAngle };

/** 解析サービスが受け付ける身長の範囲（cm） */
export const HEIGHT_CM = { min: 120, max: 230 } as const;

export function isValidHeightCm(cm: number) {
  return Number.isFinite(cm) && cm >= HEIGHT_CM.min && cm <= HEIGHT_CM.max;
}

/** リリースの、映像のフレーム番号 */
export function releaseFrame(rep: ThrowRep) {
  return rep.start + rep.events.release;
}

/** 映像のフレームが入っている投球と、そのときのフェーズ */
export function throwAt(analysis: ThrowAnalysis, frame: number): { rep: ThrowRep; phase: PhaseKey } | undefined {
  const rep = analysis.reps.find((r) => frame >= r.start && frame <= r.end);
  return rep && { rep, phase: phaseAt(rep.phases, frame - rep.start) };
}

/** 投球ごとの値の平均と幅（2 本以上あるときだけ）。一貫性を見るため */
export function spread(analysis: ThrowAnalysis, key: MetricKey): { mean: number; min: number; max: number; n: number } | undefined {
  const xs = analysis.reps.map((r) => r.metrics[key]).filter((v): v is number => v !== undefined);
  if (xs.length < 2) return undefined;
  return { mean: xs.reduce((a, b) => a + b, 0) / xs.length, min: Math.min(...xs), max: Math.max(...xs), n: xs.length };
}
