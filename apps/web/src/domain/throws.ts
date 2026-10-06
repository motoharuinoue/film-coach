// 自分の映像から見つけた投球と、1 本ずつのフェーズ・QB 指標。
// 形は packages/schema の throw-analysis.v1 と同じ（読み込みは infrastructure/http）。
// フェーズと指標の位置は投球の区間の中のフレーム番号、start / end は映像のフレーム番号。

import type { CameraAngle } from "./camera";
import type { MetricKey, MetricValues } from "./metrics";
import { phaseAt, type Events, type Phase, type PhaseKey } from "./phases";
import type { PoseSequence } from "./pose";

export type ThrowHand = "right" | "left";

/**
 * 投げ始め：ドロップしてから投げたか、その場で構えてから投げたか。
 * 頭の上下動のように、ドロップの有無で値の意味が変わる指標は、投げ始めが同じお手本とだけ比べる（judgement.zonesFor）。
 * 横から以外の角度・構えが映っていない・ステップが見つからないときは unknown
 */
export type Approach = "drop" | "standing" | "unknown";
/** 投げ始めのうち、お手本の分布を分けるもの */
export type ApproachGroup = Exclude<Approach, "unknown">;
export const APPROACH_GROUPS: ApproachGroup[] = ["drop", "standing"];
/** 投げ始めの決め方：骨格から見分ける／指定する */
export type ApproachMode = "auto" | ApproachGroup;

export const APPROACH_LABEL: Record<Approach, string> = { drop: "ドロップから", standing: "その場から", unknown: "投げ始め不明" };
export const APPROACH_MODE_LABEL: Record<ApproachMode, string> = { auto: "自動で見分ける", drop: "ドロップから", standing: "その場から" };

export type ApproachInfo = {
  kind: Approach;
  /** ステップの前に骨盤が後ろへ下がった距離（m）。測れない角度なら null */
  dropM: number | null;
};

export const isApproachGroup = (a: Approach | undefined): a is ApproachGroup => a === "drop" || a === "standing";

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
  /** 接地・リリースの瞬間で測った指標の、瞬間の時刻が半コマずれたときの変わり幅（入れる前に解析した結果にはない） */
  uncertainty?: MetricValues;
  /** 投げ始め（投げ始めを入れる前に解析した結果にはない） */
  approach?: ApproachInfo;
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
  /** スロー再生の倍率（1 は等速）。速さと時間は実際の時間に直して計算している */
  slowmo: number;
  /** 投げ始めの決め方 */
  approachMode: ApproachMode;
};

export type ThrowsRequest = { heightCm: number; camera: CameraAngle; slowmo?: number; approach?: ApproachMode };

/** 選べるスロー再生の倍率（YouTube のお手本はスロー再生が多い） */
export const SLOWMO_OPTIONS = [1, 2, 4, 8] as const;

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
