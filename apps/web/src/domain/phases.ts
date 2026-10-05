// ルールベースのフェーズ分割。M1 で Python（services/analyzer）にも同じ規則を実装する。

import { dist, kp, pelvisSeries, speedSeries, type PoseSequence } from "./pose";

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

export function detectEvents(seq: PoseSequence): Events {
  const { fps, frames } = seq;
  const last = frames.length - 1;
  const pelvis = pelvisSeries(seq);
  const pelvisSpeed = pelvis.map((_, i) => {
    const a = Math.max(0, i - 1);
    const b = Math.min(last, i + 1);
    return b === a ? 0 : (dist(pelvis[b]!, pelvis[a]!) * fps) / (b - a);
  });
  const ankleL = frames.map((f) => kp(f, "lAnkle"));
  const ankleLSpeed = speedSeries(seq, "lAnkle");
  const wristSpeed = speedSeries(seq, "rWrist");

  const minDrop = Math.round(0.25 * fps);
  // セット：ドロップで動いた骨盤が止まる
  let setStart = frames.findIndex((_, i) => i > minDrop && pelvisSpeed[i]! < 0.45);
  if (setStart < 0) setStart = minDrop;
  // ステップ：前足（左）が地面から離れる
  let strideStart = frames.findIndex((_, i) => i > setStart && ankleL[i]!.y > 0.1);
  if (strideStart < 0) strideStart = setStart + 1;
  // 接地：前足が地面に戻り、止まる
  let plant = frames.findIndex((_, i) => i > strideStart + 2 && ankleL[i]!.y < 0.095 && ankleLSpeed[i]! < 0.35);
  if (plant < 0) plant = strideStart + 1;
  // リリース：接地前後で投げる手首が最も速い瞬間
  const from = Math.max(0, plant - Math.round(0.1 * fps));
  const to = Math.min(last, plant + Math.round(0.3 * fps));
  let release = from;
  for (let i = from; i <= to; i++) if (wristSpeed[i]! > wristSpeed[release]!) release = i;
  // フォロースルー：手首の速さがピークの 45% を下回る
  const peak = wristSpeed[release]!;
  let followStart = frames.findIndex((_, i) => i > release && wristSpeed[i]! < peak * 0.45);
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
  return (phases.find((p) => frame >= p.start && frame < p.end) ?? phases[phases.length - 1]!).key;
}
