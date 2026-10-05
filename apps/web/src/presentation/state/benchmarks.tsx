// 判定の基準（お手本ゾーンと自己ベスト）を全画面で共有する。
// お手本の手動調整（ピン留め・除外・星）を変えると、すべての画面の判定が変わる。

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Benchmarks, CoachService } from "../../application/coach";
import type { ManualAdjust } from "../../domain/weighting";
import { useServices } from "../services";

type Ctx = {
  bench: Benchmarks;
  manual: Record<string, ManualAdjust>;
  update: (id: string, patch: Partial<ManualAdjust>) => void;
  reset: () => void;
  /** 既定から変えているか */
  changed: boolean;
};

const BenchmarksContext = createContext<Ctx | null>(null);

export function BenchmarksProvider({ children }: { children: ReactNode }) {
  const { coach, manualStore } = useServices();
  const defaults = useMemo(() => coach.defaultManual(), [coach]);
  const [manual, setManual] = useState<Record<string, ManualAdjust>>(() => ({ ...defaults, ...manualStore.load() }));
  useEffect(() => manualStore.save(manual), [manual, manualStore]);
  const update = useCallback((id: string, patch: Partial<ManualAdjust>) => setManual((m) => ({ ...m, [id]: { ...m[id]!, ...patch } })), []);
  const reset = useCallback(() => setManual(defaults), [defaults]);
  const bench = useMemo(() => coach.benchmarks(manual), [coach, manual]);
  const changed = useMemo(() => JSON.stringify(manual) !== JSON.stringify(defaults), [manual, defaults]);
  return <BenchmarksContext.Provider value={{ bench, manual, update, reset, changed }}>{children}</BenchmarksContext.Provider>;
}

export function useBenchmarks(): Ctx {
  const c = useContext(BenchmarksContext);
  if (!c) throw new Error("BenchmarksProvider がありません");
  return c;
}

/** 画面でよく使う組み合わせ：CoachService と現在の基準 */
export function useCoach(): { coach: CoachService; bench: Benchmarks } {
  const { coach } = useServices();
  const { bench } = useBenchmarks();
  return { coach, bench };
}
