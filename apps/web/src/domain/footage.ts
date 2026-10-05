// 自分の映像（解析サービスに取り込んだ実際の動画）と、対象選手を追った結果。
// 形は packages/schema の video-record.v1 / target-track.v1 と同じ（読み込みは infrastructure/http）。

export type FootageSource = "upload" | "youtube";
export type TrackStatus = "none" | "running" | "done" | "failed";

export type FootageInfo = { name: string; fps: number; width: number; height: number; frameCount: number; duration: number };

export type FootageYouTube = { videoId: string; start: number; end: number; title: string; channel: string; license: string; url: string };

/** API が添える、使える URL（使えないものは null） */
export type FootageLinks = {
  self: string;
  frame: string | null;
  media: string | null;
  track: string | null;
  preview: string | null;
  focus: string | null;
  events: string | null;
  /** 投球の解析結果（まだ解析していなければ null） */
  throws: string | null;
};

export type Footage = {
  id: string;
  name: string;
  source: FootageSource;
  info: FootageInfo;
  createdAt: string;
  youtube: FootageYouTube | null;
  /** 元の動画を手元に残しているか（YouTube の区間は解析のあとに消す。ADR-0005） */
  mediaRetained: boolean;
  trackStatus: TrackStatus;
  label: string;
  errors: string[];
  links: FootageLinks;
};

export type TrackBox = { x1: number; y1: number; x2: number; y2: number; score: number };
export type ImagePoint = { x: number; y: number; c: number };

export type TrackFrame = {
  i: number;
  t: number;
  box: TrackBox | null;
  /** COCO-17 の関節（画像のピクセル座標） */
  kp: ImagePoint[] | null;
  /** 見失った間を前後から補間したフレーム */
  interpolated: boolean;
};

export type TargetTrack = {
  video: { name: string; fps: number; width: number; height: number; frameCount: number };
  hint: { x: number; y: number; t: number };
  segments: { trackId: number; start: number; end: number }[];
  peopleTracked: number;
  /** 場面の切り替わり（新しい場面の最初のフレーム番号）。追跡はこれをまたがない */
  cuts: number[];
  frames: TrackFrame[];
};

export type TrackHint = { t: number; x: number; y: number; label: string };

/** t 秒に対応するフレーム */
export function frameAt(track: TargetTrack, t: number): TrackFrame | undefined {
  const i = Math.max(0, Math.min(track.frames.length - 1, Math.round(t * track.video.fps)));
  return track.frames[i];
}

/** フレーム a と b の間に場面の切り替わりがあるか（向きは問わない） */
export function crossesCut(cuts: readonly number[], a: number, b: number): boolean {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return cuts.some((c) => lo < c && c <= hi);
}

export function coverage(track: TargetTrack) {
  const found = track.frames.filter((f) => f.box).length;
  const filled = track.frames.filter((f) => f.interpolated).length;
  return { found, filled, total: track.frames.length, ratio: found / Math.max(1, track.frames.length) };
}

/** 表示する枠に、縦横比を保って収めたときの位置と倍率（余白は上下か左右に付く） */
export type Fit = { x: number; y: number; w: number; h: number; scale: number };

export function containFit(srcW: number, srcH: number, boxW: number, boxH: number): Fit {
  const scale = Math.min(boxW / srcW, boxH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h, scale };
}

/** 表示上の点 → 元の動画のピクセル */
export function toSource(fit: Fit, vx: number, vy: number) {
  return { x: (vx - fit.x) / fit.scale, y: (vy - fit.y) / fit.scale };
}

/** 元の動画のピクセル → 表示上の点 */
export function toView(fit: Fit, sx: number, sy: number) {
  return { x: fit.x + sx * fit.scale, y: fit.y + sy * fit.scale };
}

/**
 * フォーカス表示：対象選手を中心に、枠の高さの factor 倍の正方形が画面の高さになるよう拡大する。
 * 拡大しても動画の外が見えないよう、中心を寄せる。戻り値は元の動画のピクセルでの中心と倍率。
 */
export function focusWindow(box: TrackBox, srcW: number, srcH: number, factor = 2.6, maxScale = 5) {
  const side = Math.min(srcH, Math.max(srcH / maxScale, (box.y2 - box.y1) * factor));
  const scale = srcH / side;
  const halfW = srcW / scale / 2;
  const halfH = srcH / scale / 2;
  const cx = Math.min(srcW - halfW, Math.max(halfW, (box.x1 + box.x2) / 2));
  const cy = Math.min(srcH - halfH, Math.max(halfH, (box.y1 + box.y2) / 2));
  return { cx, cy, scale };
}
