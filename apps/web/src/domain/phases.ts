// ルールベースのフェーズ分割。Python（services/analyzer/src/film_coach/domain/phases.py）も同じ規則で実装する。

import { kp, pelvisSeries, speedSeries, type PoseSequence } from "./pose";

export type PhaseKey = "drop" | "set" | "stride" | "release" | "follow";

export const PHASE_LABEL: Record<PhaseKey, string> = {
  drop: "ドロップ",
  set: "セット",
  stride: "ステップ",
  release: "リリース",
  follow: "フォロー",
};

export type Phase = { key: PhaseKey; start: number; end: number };

/** フレーム番号で表したイベント */
export type Events = {
  setStart: number;
  strideStart: number;
  plant: number;
  release: number;
  followStart: number;
  last: number;
};

/** 前足が前へ動いているとみなす速さ（m/s） */
export const STRIDE_SPEED = 0.5;
/** 骨盤が後ろへ下がっている（ドロップ）とみなす速さ（m/s） */
export const DROP_SPEED = 0.5;
/** リリースからさかのぼって前足の動きを探す範囲（秒） */
const STRIDE_SEARCH_S = 0.8;

/** 横（投げる方向）の速度（m/s、前向きが正）。中心差分、端は片側差分 */
function velocityX(xs: number[], fps: number): number[] {
  const last = xs.length - 1;
  return xs.map((_, i) => {
    const a = Math.max(0, i - 1);
    const b = Math.min(last, i + 1);
    return b === a ? 0 : ((xs[b]! - xs[a]!) * fps) / (b - a);
  });
}

/**
 * イベントを、リリースからさかのぼって決める。横の動きの速さだけを使い、足首の高さは使わない
 * （実際の映像では、カメラから遠い足ほど画面の上に映り、高さで接地を判定できないため）。
 * 1. リリース：投げる手首が最も速い瞬間
 * 2. 接地：さかのぼって、前足（左）が前へ動いていた最後のフレームの次
 * 3. ステップ：さらにさかのぼって、前足が前へ動き始めたフレーム
 * 4. セット：その前で、骨盤が後ろへ下がっていた（ドロップ）最後のフレームの次。ドロップがなければ 0
 * 5. フォロースルー：手首の速さがピークの 45% を下回る
 */
export function detectEvents(seq: PoseSequence): Events {
  const { fps, frames } = seq;
  const last = frames.length - 1;
  const wristSpeed = speedSeries(seq, "rWrist");
  const ankleVx = velocityX(frames.map((f) => kp(f, "lAnkle").x), fps);
  const pelvisVx = velocityX(pelvisSeries(seq).map((p) => p.x), fps);

  const lead = Math.min(last, Math.round(0.25 * fps));
  let release = lead;
  for (let i = lead; i <= last; i++) if (wristSpeed[i]! > wristSpeed[release]!) release = i;

  const limit = Math.max(0, release - Math.round(STRIDE_SEARCH_S * fps));
  let i = release;
  while (i > limit && ankleVx[i]! <= STRIDE_SPEED) i--;
  let plant = release;
  let strideStart = Math.max(0, release - 1);
  if (ankleVx[i]! > STRIDE_SPEED) {
    plant = i + 1;
    while (i > 0 && ankleVx[i - 1]! > STRIDE_SPEED) i--;
    strideStart = i;
  }

  let setStart = 0;
  for (let k = strideStart - 1; k >= 0; k--) {
    if (pelvisVx[k]! < -DROP_SPEED) {
      setStart = k + 1;
      break;
    }
  }

  const peak = wristSpeed[release]!;
  let followStart = frames.findIndex((_, k) => k > release && wristSpeed[k]! < peak * 0.45);
  if (followStart < 0) followStart = Math.min(last, release + 3);
  return { setStart, strideStart, plant, release, followStart, last };
}

export function toPhases(e: Events): Phase[] {
  return [
    { key: "drop", start: 0, end: e.setStart },
    { key: "set", start: e.setStart, end: e.strideStart },
    { key: "stride", start: e.strideStart, end: e.plant },
    { key: "release", start: e.plant, end: e.followStart },
    { key: "follow", start: e.followStart, end: e.last },
  ];
}

export function phaseAt(phases: Phase[], frame: number): PhaseKey {
  return (
    phases.find((p) => frame >= p.start && frame < p.end) ??
    phases[phases.length - 1]!
  ).key;
}
