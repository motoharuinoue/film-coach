// AnalysisGateway のシミュレーション実装（M0）。段階を順に進め、結果としてデモのセッションを返す。

import type { AnalysisGateway, AnalysisInput, AnalysisProgress, AnalysisResult, SessionRepository } from "../../application/ports";

const STAGES = ["動画の正規化（H.264 / 固定 fps）", "人物検出（RTMDet）", "追跡（ByteTrack）", "骨格推定（RTMPose）", "平滑化", "フェーズ分割", "指標の計算", "判定（自己ベスト・お手本ゾーン）"];
const POSE_STAGE = 3;

export class SimulatedAnalysisGateway implements AnalysisGateway {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly stepMs = () => 520 + Math.random() * 380,
  ) {}

  stages() {
    return STAGES;
  }

  async run(_input: AnalysisInput, onProgress: (p: AnalysisProgress) => void, signal?: AbortSignal): Promise<AnalysisResult> {
    const { session, rep } = this.sessions.focus();
    for (let completed = 1; completed <= STAGES.length; completed++) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, this.stepMs());
        signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new DOMException("中止しました", "AbortError"));
        });
      });
      const frames = rep.seq.frames;
      const preview = completed > POSE_STAGE ? frames[Math.min(frames.length - 1, Math.floor((completed / STAGES.length) * frames.length))] : undefined;
      onProgress({ completed, preview });
    }
    return { sessionId: session.id, repCount: session.reps.length };
  }
}
