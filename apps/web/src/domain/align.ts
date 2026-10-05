// ゴースト比較のための位置合わせ。時間はリリースのフレームで揃え、
// 位置は接地時の後ろ足（右足首）が重なるように平行移動する。
// M2 で DTW（動的時間伸縮）による全区間の対応付けに置き換える。

import { kp, type PoseSequence, type Vec2 } from "./pose";

export type Alignable = { seq: PoseSequence; events: { release: number; plant: number } };

export function alignedFrame(self: Alignable, other: Alignable, frame: number) {
  const f = other.events.release + (frame - self.events.release);
  return Math.max(0, Math.min(other.seq.frames.length - 1, f));
}

export function alignOffset(self: Alignable, other: Alignable): Vec2 {
  const a = kp(self.seq.frames[self.events.plant]!, "rAnkle");
  const b = kp(other.seq.frames[other.events.plant]!, "rAnkle");
  return { x: a.x - b.x, y: a.y - b.y };
}
