// 骨格を描く範囲（カメラ）を、骨格に合わせて決める。
// 座標の原点はデータによって違う（デモの合成データ、手元の映像、YouTube のお手本）ので、
// 決め打ちの範囲では、骨格が端に寄ったり切れたりする。

import type { PoseFrame } from "../../domain/pose";
import type { Camera } from "./scene";

/** 縦横比（FieldScene の 1600×900 と同じ）。これと違う比率の範囲を渡すと、骨格が縦か横につぶれる */
const ASPECT = 9 / 16;
/** 骨格のまわりの余白（m） */
const PAD = 0.35;
/** 地面より下に見せる高さ（m） */
const BELOW = 0.15;
/** 上の端の最低の高さ（m）。しゃがんだ姿勢でも、拡大しすぎないように */
const MIN_TOP = 1.9;

/**
 * 全フレームの関節が余白を残して収まる範囲（16:9）。横は関節の左右の端の真ん中、縦は地面の少し下から。
 * minWidth を指定すると、それより狭くしない（投球の区間を通して同じ大きさで見せるときに使う）
 */
export function fitCamera(frames: PoseFrame[], minWidth = 0): Camera {
  let lo = Infinity;
  let hi = -Infinity;
  let top = 0;
  for (const f of frames)
    for (const p of f.kp) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      lo = Math.min(lo, p.x);
      hi = Math.max(hi, p.x);
      top = Math.max(top, p.y);
    }
  if (lo > hi) return { x0: -2, x1: 2, y0: -BELOW, y1: -BELOW + 4 * ASPECT };
  const height = Math.max(top + PAD, MIN_TOP) + BELOW;
  const width = Math.max(minWidth, hi - lo + 2 * PAD, height / ASPECT);
  const c = (lo + hi) / 2;
  return { x0: c - width / 2, x1: c + width / 2, y0: -BELOW, y1: -BELOW + width * ASPECT };
}
