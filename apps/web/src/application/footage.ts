// ユースケース：対象選手の追跡を始め、終わるまで待つ。

import type { TrackHint } from "../domain/footage";
import type { FootageLibrary, TrackingProgress, TrackingSummary } from "./ports";

export class TrackingFailed extends Error {}

/** 追跡を始め、終わったら要約を返す。signal で待つのをやめられる（解析そのものは解析サービスで続く） */
export async function trackFootage(
  lib: FootageLibrary,
  id: string,
  hint: TrackHint,
  onProgress: (p: TrackingProgress) => void,
  signal?: AbortSignal,
): Promise<TrackingSummary> {
  const job = await lib.startTracking(id, hint);
  return new Promise<TrackingSummary>((resolve, reject) => {
    const stop = lib.follow(job.events, {
      onProgress,
      onDone: (s) => {
        stop();
        resolve(s);
      },
      onFailed: (m) => {
        stop();
        reject(new TrackingFailed(m));
      },
    });
    signal?.addEventListener("abort", () => {
      stop();
      reject(new DOMException("待つのをやめました", "AbortError"));
    });
  });
}

/** 進み具合を 0〜1 にする（検出と骨格推定を半分ずつとみなす） */
export function overallProgress(p: TrackingProgress | undefined) {
  if (!p) return 0;
  const r = p.done / Math.max(1, p.total);
  return p.stage === "pose" ? 0.5 + r / 2 : r / 2;
}
