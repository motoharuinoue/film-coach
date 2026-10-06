// 手元の解析サービスのデータ（お手本・練習・お手本の手動調整）を全画面で共有する。
// ほかの画面で解析・登録した結果を映すため、画面を移るたびに読み直す（AppShell から reload を呼ぶ）。
// 練習があれば、ホーム・レップ・スタジオ・レポート・推移も手元のデータで見られる（表示するデータはデモと切り替えられる）。

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Benchmarks, CoachService } from "../../application/coach";
import { focusOf, loadLocalSessions, localPlayer, type LocalSessions } from "../../application/localData";
import { loadLocalReferences, type LocalLibrary } from "../../application/localReferences";
import { NEUTRAL_MANUAL, weighByApproach, weighReferences, zoneSetOf, type ReferenceWeights } from "../../application/references";
import type { ApproachGroup } from "../../domain/throws";
import type { ManualAdjust } from "../../domain/weighting";
import { usePersistentState } from "../hooks/usePersistentState";
import { useServices } from "../services";
import { useAnalyzer } from "./analyzer";

export type DataSource = "demo" | "local";

type Ctx = {
  library?: LocalLibrary;
  sessions?: LocalSessions;
  manual: Record<string, ManualAdjust>;
  weights?: ReferenceWeights;
  byApproach?: Record<ApproachGroup, ReferenceWeights>;
  /** 手元の練習で作った CoachService と基準。練習（投球のあるもの）がなければ undefined */
  local?: { coach: CoachService; bench: Benchmarks };
  update: (id: string, patch: Partial<ManualAdjust>) => void;
  reset: () => void;
  reload: () => Promise<void>;
  loading: boolean;
  error?: string;
  /** 利用者が選んだ表示するデータ（選んでいなければ undefined） */
  preferred?: DataSource;
  setPreferred: (s: DataSource) => void;
};

const LocalDataContext = createContext<Ctx | null>(null);

const same = (a: ManualAdjust, b: ManualAdjust) => a.pinned === b.pinned && a.excluded === b.excluded && a.stars === b.stars;

export function LocalDataProvider({ children }: { children: ReactNode }) {
  const services = useServices();
  const { lib, status } = useAnalyzer();
  const [library, setLibrary] = useState<LocalLibrary>();
  const [sessions, setSessions] = useState<LocalSessions>();
  const [manual, setManual] = useState<Record<string, ManualAdjust>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [preferred, setPreferred] = usePersistentState<DataSource | undefined>("film-coach:data-source", undefined);
  // 続けて変えても、最新の値に重ねて送る
  const latest = useRef(manual);
  latest.current = manual;

  const reload = useCallback(async () => {
    if (!lib || status !== "online") return;
    setLoading(true);
    try {
      const [l, s] = await Promise.all([loadLocalReferences(lib), loadLocalSessions(lib)]);
      setLibrary(l);
      setSessions(s);
      setManual(Object.fromEntries(l.records.map((r) => [r.id, r.manual])));
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [lib, status]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const update = useCallback(
    (id: string, patch: Partial<ManualAdjust>) => {
      const next = { ...(latest.current[id] ?? NEUTRAL_MANUAL), ...patch };
      latest.current = { ...latest.current, [id]: next };
      setManual(latest.current);
      void lib?.updateReference(id, { manual: next }).catch((e: Error) => setError(e.message));
    },
    [lib],
  );
  const reset = useCallback(() => {
    for (const [id, m] of Object.entries(latest.current)) if (!same(m, NEUTRAL_MANUAL)) update(id, NEUTRAL_MANUAL);
  }, [update]);

  const weights = useMemo(() => (library ? weighReferences(library.refs, manual) : undefined), [library, manual]);
  const byApproach = useMemo(() => (library ? weighByApproach(library.refs, manual) : undefined), [library, manual]);
  const local = useMemo(() => {
    if (!library || !sessions || !weights || !byApproach) return undefined;
    const focus = focusOf(sessions.sessions, zoneSetOf(weights, byApproach));
    if (!focus) return undefined;
    const coach = services.localCoach({ player: localPlayer(services.profile.heightCm(), sessions.hand), sessions: sessions.sessions, focus, references: library.refs });
    return { coach, bench: coach.benchmarks(manual) };
  }, [library, sessions, weights, byApproach, manual, services]);

  return (
    <LocalDataContext.Provider value={{ library, sessions, manual, weights, byApproach, local, update, reset, reload, loading, error, preferred, setPreferred }}>
      {children}
    </LocalDataContext.Provider>
  );
}

export function useLocalData(): Ctx {
  const c = useContext(LocalDataContext);
  if (!c) throw new Error("LocalDataProvider がありません");
  return c;
}

/** 表示するデータ。手元の練習があれば既定は手元、利用者が選べばそれに従う（手元がなければデモ） */
export function useDataSource(): { source: DataSource; available: boolean; setSource: (s: DataSource) => void; loading: boolean } {
  const { local, preferred, setPreferred, loading } = useLocalData();
  const available = local !== undefined;
  return { source: available && preferred !== "demo" ? "local" : "demo", available, setSource: setPreferred, loading };
}
