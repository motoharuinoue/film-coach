// デモ用の解析：合成骨格を、解析サービス（M1）と同じ手順で処理する。
// 平滑化 → フェーズ分割 → 指標 → カメラ角度で測れない指標を捨てる。

import type { CameraAngle } from "../../domain/camera";
import type { AnalyzedRep } from "../../domain/entities";
import { computeMetrics, onlyValid } from "../../domain/metrics";
import { detectEvents, toPhases } from "../../domain/phases";
import { smoothSequence } from "../../domain/pose";
import { rotationVelocity, synthesizeThrow, type SequenceTiming, type ThrowParams } from "./synth";

/** 骨盤→体幹のピーク間隔 gap（秒）から、各部位のピーク時刻（リリース基準）を決める */
function timingFor(gap: number): SequenceTiming {
  return { pelvis: -0.05 - gap, trunk: -0.05, arm: -0.012 };
}

export function analyzeSynthetic(input: {
  id: string;
  index: number;
  params: Partial<ThrowParams>;
  camera: CameraAngle;
  /** 骨盤→体幹のピーク間隔（秒） */
  gap: number;
  /** 腰と肩の捻り差（度）。後方・正面の映像のときだけ */
  hss?: number;
}): AnalyzedRep {
  const seq = smoothSequence(synthesizeThrow(input.params));
  const events = detectEvents(seq);
  const metrics = onlyValid(computeMetrics(seq, events, { hipShoulderSep: input.hss, sequenceGapS: input.gap }), input.camera);
  return {
    id: input.id,
    index: input.index,
    seq,
    events,
    phases: toPhases(events),
    metrics,
    rotation: rotationVelocity(seq, events.release / seq.fps, timingFor(input.gap)),
    // 合成データはどれもドロップしてから投げる
    approach: "drop",
  };
}
