// ユースケース：練習にまとめた映像と、その投球をまとめて読む。投球をまだ解析していない映像は、まとめて解析する。

import type { Footage } from "../domain/footage";
import { collectThrows, type Practice, type PracticeThrow } from "../domain/practice";
import type { ThrowAnalysis } from "../domain/throws";
import type { FootageLibrary } from "./ports";

export type PracticeEntry = { footage: Footage; analysis?: ThrowAnalysis };

export type PracticeView = {
  practice: Practice;
  entries: PracticeEntry[];
  throws: PracticeThrow[];
  /** 追跡は済んでいて、投球をまだ解析していない映像 */
  unanalyzed: Footage[];
  /** まだ本人を追跡していない映像 */
  untracked: Footage[];
};

export function viewOf(practice: Practice, entries: PracticeEntry[]): PracticeView {
  return {
    practice,
    entries,
    throws: collectThrows(entries.map((e) => ({ id: e.footage.id, name: e.footage.name, analysis: e.analysis }))),
    unanalyzed: entries.filter((e) => !e.analysis && e.footage.trackStatus === "done").map((e) => e.footage),
    untracked: entries.filter((e) => e.footage.trackStatus !== "done").map((e) => e.footage),
  };
}

/** 練習の映像と投球の解析結果を、まとめた順に読む */
export async function loadPractice(lib: FootageLibrary, id: string): Promise<PracticeView> {
  const practice = await lib.practice(id);
  const entries = await Promise.all(
    practice.videoIds.map(async (vid): Promise<PracticeEntry> => {
      const footage = await lib.get(vid);
      return { footage, analysis: footage.links.throws ? await lib.throws(footage) : undefined };
    }),
  );
  return viewOf(practice, entries);
}

/** 投球をまだ解析していない映像を、同じ身長でまとめて解析する（1 本ずつ順に） */
export async function analyzeUnanalyzed(lib: FootageLibrary, view: PracticeView, heightCm: number): Promise<PracticeView> {
  const done = new Map<string, ThrowAnalysis>();
  for (const f of view.unanalyzed) done.set(f.id, await lib.analyzeThrows(f.id, { heightCm, camera: view.practice.camera }));
  return viewOf(
    view.practice,
    view.entries.map((e) => ({ ...e, analysis: done.get(e.footage.id) ?? e.analysis })),
  );
}
