// ユースケース：手元の解析サービスの練習を読み、デモと同じセッション（Session）に写す。
// 写したあとは、デモと同じ評価・改善点・一貫性・推移のユースケース（CoachService）を通す。

import type { AnalyzedRep, Player, Session } from "../domain/entities";
import type { ZoneSet } from "../domain/judgement";
import type { ThrowHand } from "../domain/throws";
import { repScore } from "./evaluation";
import type { FootageLibrary } from "./ports";
import { viewFor, type PracticeView } from "./practice";

/** 練習をセッションに写す。投球が 1 本もない練習（まだ解析していない など）は写さない */
export function toSession(view: PracticeView): Session | undefined {
  const p = view.practice;
  const reps: AnalyzedRep[] = view.throws.map((t, i) => ({
    id: `${t.footageId}#${t.rep.index}`,
    index: i,
    seq: t.rep.sequence,
    events: t.rep.events,
    phases: t.rep.phases,
    metrics: t.rep.metrics,
    uncertainty: t.rep.uncertainty,
    // 回転の速さは 3D の骨格（M5）で測る。2D の映像からは出さない
    rotation: [],
    approach: t.rep.approach?.kind ?? "unknown",
    clip: { videoId: t.footageId, frame0: t.rep.start, videoFps: t.fps },
  }));
  if (!reps.length) return undefined;
  return { id: p.id, date: p.date, kind: p.kind, camera: p.camera, title: p.name, source: "local", reps };
}

export type LocalSessions = {
  /** 古い順（日付、同じ日なら先に作ったものを先に）。デモと同じく、最新は最後 */
  sessions: Session[];
  /** 投球を解析した映像の投げる腕（いちばん多いもの） */
  hand?: ThrowHand;
  /** 投球がまだなく、写さなかった練習の数 */
  skipped: number;
};

export async function loadLocalSessions(lib: FootageLibrary): Promise<LocalSessions> {
  const practices = await lib.practices();
  const views = await Promise.all(practices.map((p) => viewFor(lib, p).catch(() => undefined)));
  const ok = views.filter((v): v is PracticeView => v !== undefined);
  const pairs = ok.map((v) => ({ v, s: toSession(v) })).filter((x): x is { v: PracticeView; s: Session } => x.s !== undefined);
  pairs.sort((a, b) => a.s.date.localeCompare(b.s.date) || a.v.practice.createdAt.localeCompare(b.v.practice.createdAt));
  const hands = ok.flatMap((v) => v.entries.map((e) => e.analysis?.hand)).filter((h): h is ThrowHand => h !== undefined);
  const left = hands.filter((h) => h === "left").length;
  return {
    sessions: pairs.map((x) => x.s),
    hand: hands.length ? (left > hands.length / 2 ? "left" : "right") : undefined,
    skipped: practices.length - pairs.length,
  };
}

/** 手元のデータの選手。名前・背番号は持たず、身長はこの端末に保存したものを使う */
export function localPlayer(heightCm: number | undefined, hand: ThrowHand | undefined): Player {
  return { position: "QB", heightCm, throws: hand === "left" ? "左投げ" : hand === "right" ? "右投げ" : "—" };
}

/** ホームで取り上げるレップ：最新のセッション（最後）の、スコアがいちばん低い投球（同じなら先のもの） */
export function focusOf(sessions: Session[], set: ZoneSet): { session: Session; rep: AnalyzedRep } | undefined {
  const session = sessions[sessions.length - 1];
  if (!session) return undefined;
  let rep = session.reps[0]!;
  for (const r of session.reps) if (repScore(r, set) < repScore(rep, set)) rep = r;
  return { session, rep };
}
