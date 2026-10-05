// ユースケース：手元の解析サービスに登録したお手本を読み、デモと同じ Reference の形に写す。
// 写したあとは、デモと同じ重み付け（weighReferences）と分布の計算を通す。

import type { AnalyzedRep, Reference } from "../domain/entities";
import type { Footage } from "../domain/footage";
import { resolutionClass, type LocalReference } from "../domain/reference";
import type { ThrowAnalysis } from "../domain/throws";
import { formatTime } from "../domain/youtube";
import type { FootageLibrary } from "./ports";

/** 投球の骨格の、関節の信頼度の平均（解析品質 Q に使う） */
export function meanConfidence(throws: ThrowAnalysis) {
  let sum = 0;
  let n = 0;
  for (const r of throws.reps) for (const f of r.sequence.frames) for (const p of f.kp) (sum += p.c), n++;
  return n ? sum / n : 0;
}

export function toReference(r: LocalReference, footage: Footage, throws: ThrowAnalysis): Reference {
  const yt = footage.youtube;
  const reps: AnalyzedRep[] = throws.reps.map((rep) => ({
    id: `${r.id}#${rep.index}`,
    index: rep.index,
    seq: rep.sequence,
    events: rep.events,
    phases: rep.phases,
    metrics: rep.metrics,
    // 回転の速さは 3D の骨格（M5）で測る。2D の映像からは出さない
    rotation: [],
  }));
  return {
    id: r.id,
    title: r.title,
    channel: r.channel,
    publishedAt: r.stats.publishedAt.slice(0, 10),
    duration: formatTime(r.stats.durationSec),
    segment: { start: formatTime(yt?.start ?? 0), end: formatTime(yt?.end ?? 0) },
    creativeCommons: r.license === "creativeCommon",
    kind: r.kind,
    tags: [],
    stats: {
      views: r.stats.views,
      likes: r.stats.likes ?? 0,
      subscribers: r.stats.subscribers ?? 0,
      trustedChannel: r.trustedChannel,
      camera: throws.camera,
      resolution: resolutionClass(footage.info.width, footage.info.height),
      fps: footage.info.fps,
      confidence: meanConfidence(throws),
    },
    reps,
  };
}

export type LocalLibrary = {
  records: LocalReference[];
  /** 投球の解析結果まで読めたお手本（画面と重み付けに使う） */
  refs: Reference[];
  /** 元の映像か投球の解析結果が読めなかったお手本 */
  broken: LocalReference[];
};

export async function loadLocalReferences(lib: FootageLibrary): Promise<LocalLibrary> {
  const records = await lib.references();
  const loaded = await Promise.all(
    records.map(async (r) => {
      try {
        const footage = await lib.get(r.videoId);
        const throws = footage.links.throws ? await lib.throws(footage) : undefined;
        return throws && throws.reps.length ? toReference(r, footage, throws) : undefined;
      } catch {
        return undefined;
      }
    }),
  );
  return {
    records,
    refs: loaded.filter((x): x is Reference => x !== undefined),
    broken: records.filter((_, i) => loaded[i] === undefined),
  };
}
