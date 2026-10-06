// ドメインのエンティティ。解析サービス（M1）の出力もこの形にそろえる。

import type { CameraAngle } from "./camera";
import type { MetricValues } from "./metrics";
import type { Events, Phase } from "./phases";
import type { PoseSequence } from "./pose";
import type { Approach } from "./throws";
import type { ReferenceStats } from "./weighting";

export type Player = {
  name: string;
  number: number;
  position: string;
  heightCm: number;
  throws: string;
  team: string;
};

/** 骨盤・体幹・腕の回転速度（度/秒）。フレームごとの値 */
export type RotationCurve = { key: "pelvis" | "trunk" | "arm"; peakT: number; values: number[] };

/** 解析済みのレップ（1 回の投球） */
export type AnalyzedRep = {
  id: string;
  index: number;
  seq: PoseSequence;
  events: Events;
  phases: Phase[];
  metrics: MetricValues;
  rotation: RotationCurve[];
  /** 投げ始め（手元のお手本だけ。デモの合成データは持たない） */
  approach?: Approach;
  /** 元の映像の中の位置（手元のお手本だけ）。骨格のフレーム i は、映像のフレーム frame0 + i */
  clip?: { videoId: string; frame0: number; videoFps: number };
};

export type SessionKind = "drill" | "game";

export type Session = {
  id: string;
  date: string;
  kind: SessionKind;
  camera: CameraAngle;
  title: string;
  source: "local" | "youtube";
  reps: AnalyzedRep[];
};

export type ReferenceKind = "model" | "drill" | "ng";

export const KIND_LABEL: Record<ReferenceKind, string> = {
  model: "お手本の投球",
  drill: "ドリル解説",
  ng: "NG 例",
};

/** YouTube から取り込んだお手本。元の動画は持たず、出典と派生データだけを持つ（ADR-0005） */
export type Reference = {
  id: string;
  title: string;
  channel: string;
  publishedAt: string;
  duration: string;
  segment: { start: string; end: string };
  creativeCommons: boolean;
  kind: ReferenceKind;
  tags: string[];
  stats: ReferenceStats;
  reps: AnalyzedRep[];
};

/** 自己ベストのレップ（どのセッションのものか付き） */
export type BestRep = AnalyzedRep & { sessionId: string; date: string };
