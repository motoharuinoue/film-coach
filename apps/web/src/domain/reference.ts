// 手元のお手本（解析サービスの登録。形は packages/schema の reference.v1）。
// 画面では、デモと同じ Reference（entities.ts）に写して、同じ重み付けと分布の計算を通す。

import type { ReferenceKind } from "./entities";
import type { ManualAdjust } from "./weighting";

export type LocalReference = {
  id: string;
  /** 元になった映像（取り込んだ YouTube の区間）の ID */
  videoId: string;
  youtubeId: string;
  title: string;
  channel: string;
  channelId: string;
  license: string;
  kind: ReferenceKind;
  trustedChannel: boolean;
  /** お手本の選手の身長（縮尺と cm の指標に使う） */
  playerHeightCm: number;
  /** 登録したとき（または取り直したとき）の YouTube の統計。非公開の値は null */
  stats: { views: number; likes: number | null; comments: number | null; subscribers: number | null; durationSec: number; publishedAt: string; fetchedAt: string };
  manual: ManualAdjust;
  createdAt: string;
};

export type ReferenceRequest = { footageId: string; kind: ReferenceKind; trustedChannel: boolean; playerHeightCm: number };

export type ReferencePatch = { kind?: ReferenceKind; trustedChannel?: boolean; manual?: ManualAdjust };

/** お手本の選手の身長が分からないときの値（NFL の QB の平均くらい） */
export const DEFAULT_PLAYER_HEIGHT_CM = 188;

/** 映像の短い辺を、解析品質 Q の解像度の区分にそろえる */
export function resolutionClass(width: number, height: number): 480 | 720 | 1080 | 2160 {
  const s = Math.min(width, height);
  return s >= 2160 ? 2160 : s >= 1080 ? 1080 : s >= 720 ? 720 : 480;
}
