// ゴースト比較のための位置合わせ。
// 時間：フェーズの区切り（セット・ステップ開始・接地・リリース・フォロー開始）を対応させ、区切りの間は線形に伸び縮みさせる。
//   形の近さで対応を探す DTW より、ルールで見つけたイベントで合わせるほうが、撮り方で形が変わる 2D の骨格でも崩れにくい。
//   どちらかで見つかっていない区切り（ステップがない、ステップの始まりが映っていない など）は使わない。fps が違っても秒で合わせる。
// 体格：比べる相手の骨格を、自分の身長に合わせて拡大・縮小する（地面と区間の最初の骨盤が原点）。
// 位置：接地時の後ろ足（右足首）が重なるように平行移動する。ステップが見つからなければ、リリース時の骨盤の前後位置で合わせる。

import { strideFound, strideSeen, type Events } from "./phases";
import { kp, mid, type PoseFrame, type PoseSequence, type Vec2 } from "./pose";

export type Alignable = { seq: PoseSequence; events: Events };

type AnchorKey = "setStart" | "strideStart" | "plant" | "release" | "followStart";
const ANCHORS: AnchorKey[] = ["setStart", "strideStart", "plant", "release", "followStart"];

/** その区切りが見つかっているか */
function found(a: Alignable, k: AnchorKey) {
  const e = a.events;
  if (k === "setStart") return e.setStart > 0; // 0 はドロップがない（区切りではない）
  if (k === "strideStart") return strideSeen(e);
  if (k === "plant") return strideFound(e);
  return true;
}

/** 両方で見つかっている区切りの時刻の組（秒）。前後関係が崩れるものは除く。リリースは必ず入る */
export function anchors(self: Alignable, other: Alignable): [number, number][] {
  const out: [number, number][] = [];
  for (const k of ANCHORS) {
    if (!found(self, k) || !found(other, k)) continue;
    const pair: [number, number] = [self.events[k] / self.seq.fps, other.events[k] / other.seq.fps];
    const prev = out[out.length - 1];
    if (prev && (pair[0] <= prev[0] || pair[1] <= prev[1])) continue;
    out.push(pair);
  }
  return out;
}

/** 自分のフレームに対応する、比べる相手のフレーム。最初と最後の区切りの外は、伸び縮みさせずにずらす */
export function alignedFrame(self: Alignable, other: Alignable, frame: number) {
  const as = anchors(self, other);
  const t = frame / self.seq.fps;
  const first = as[0]!;
  const last = as[as.length - 1]!;
  let to: number;
  if (t <= first[0]) to = first[1] + (t - first[0]);
  else if (t >= last[0]) to = last[1] + (t - last[0]);
  else {
    const k = as.findIndex((a, i) => t >= a[0] && t < as[i + 1]![0]);
    const [a, b] = [as[k]!, as[k + 1]!];
    to = a[1] + ((t - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
  }
  return Math.max(0, Math.min(other.seq.frames.length - 1, Math.round(to * other.seq.fps)));
}

/** 比べる相手の骨格の置き方：scale 倍してから offset だけ動かす */
export type Fit = { scale: number; offset: Vec2 };

export function fitTo(self: Alignable, other: Alignable): Fit {
  const scale = self.seq.heightM / other.seq.heightM;
  if (strideFound(self.events) && strideFound(other.events)) {
    const a = kp(self.seq.frames[self.events.plant]!, "rAnkle");
    const b = kp(other.seq.frames[other.events.plant]!, "rAnkle");
    return { scale, offset: { x: a.x - scale * b.x, y: a.y - scale * b.y } };
  }
  const pelvis = (x: Alignable) => {
    const f = x.seq.frames[x.events.release]!;
    return mid(kp(f, "lHip"), kp(f, "rHip"));
  };
  return { scale, offset: { x: pelvis(self).x - scale * pelvis(other).x, y: 0 } };
}

export function applyFit(frame: PoseFrame, fit: Fit): PoseFrame {
  return { ...frame, kp: frame.kp.map((p) => ({ x: p.x * fit.scale + fit.offset.x, y: p.y * fit.scale + fit.offset.y, c: p.c })) };
}
