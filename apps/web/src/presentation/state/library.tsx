// お手本ライブラリの画面が使う一式：お手本・重み・手動調整・分布に重ねる自分の値。
// デモ（合成データ、手動調整はブラウザに保存）と、手元のお手本（解析サービス、手動調整も解析サービスに保存）の 2 つがある。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadLocalReferences, type LocalLibrary } from "../../application/localReferences";
import { NEUTRAL_MANUAL, weighByApproach, weighReferences, zoneSetOf, type ReferenceWeights } from "../../application/references";
import type { Reference } from "../../domain/entities";
import { EMPTY_ZONE_SET, type ZoneSet, type Zones } from "../../domain/judgement";
import { isValidFor, METRIC_BY_KEY, type MetricKey, type MetricValues } from "../../domain/metrics";
import type { LocalReference } from "../../domain/reference";
import type { ApproachGroup } from "../../domain/throws";
import type { ManualAdjust } from "../../domain/weighting";
import { useAnalyzer } from "./analyzer";
import { useBenchmarks, useCoach } from "./benchmarks";

export type LibraryView = {
  source: "demo" | "local";
  refs: Reference[];
  weights: ReferenceWeights;
  zones: Zones;
  /** 投げ始めごとの重みと分布（手元のお手本だけ。デモの合成データは投げ始めを持たない） */
  byApproach?: Record<ApproachGroup, ReferenceWeights>;
  manual: Record<string, ManualAdjust>;
  update: (id: string, patch: Partial<ManualAdjust>) => void;
  reset: () => void;
  /** 手動調整を既定から変えているか */
  changed: boolean;
  /** 分布に重ねる自分の値（測れなければ undefined） */
  you: (metric: MetricKey) => number | undefined;
  best?: MetricValues;
  /** 手元のお手本だけ：登録の情報と、統計の取り直し・削除 */
  local?: { records: Record<string, LocalReference>; refresh: (id: string) => Promise<void>; remove: (id: string) => Promise<void> };
};

export function useDemoLibrary(): LibraryView {
  const { coach, bench } = useCoach();
  const { manual, update, reset, changed } = useBenchmarks();
  const { session, rep } = coach.focus();
  return {
    source: "demo",
    refs: coach.references(),
    weights: bench.weights,
    zones: bench.zones,
    manual,
    update,
    reset,
    changed,
    you: (metric) => (isValidFor(METRIC_BY_KEY[metric], session.camera) ? rep.metrics[metric] : undefined),
    best: bench.best?.metrics,
  };
}

const same = (a: ManualAdjust, b: ManualAdjust) => a.pinned === b.pinned && a.excluded === b.excluded && a.stars === b.stars;

/** 自分の投球の判定と重ね表示に使う、手元のお手本（ゾーン一式とお手本そのもの）。お手本がなければゾーンは空 */
export function useReferenceZones(): { zoneSet: ZoneSet; refCount: number; loading: boolean; view?: LibraryView } {
  const { view, loading } = useLocalLibrary();
  const zoneSet = view?.byApproach ? zoneSetOf(view.weights, view.byApproach) : EMPTY_ZONE_SET;
  return { zoneSet, refCount: view?.refs.length ?? 0, loading, view };
}

/** 手元のお手本。解析サービスにつながっていなければ view は undefined */
export function useLocalLibrary(): { view?: LibraryView; loading: boolean; error?: string; library?: LocalLibrary } {
  const { lib, status } = useAnalyzer();
  const [library, setLibrary] = useState<LocalLibrary>();
  const [error, setError] = useState<string>();
  const [manual, setManual] = useState<Record<string, ManualAdjust>>({});
  // 続けて変えても、最新の値に重ねて送る
  const latest = useRef(manual);
  latest.current = manual;

  const load = useCallback(async () => {
    if (!lib) return;
    try {
      const l = await loadLocalReferences(lib);
      setLibrary(l);
      setManual(Object.fromEntries(l.records.map((r) => [r.id, r.manual])));
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [lib]);

  useEffect(() => {
    if (status === "online") void load();
  }, [status, load]);

  const weights = useMemo(() => (library ? weighReferences(library.refs, manual) : undefined), [library, manual]);
  const byApproach = useMemo(() => (library ? weighByApproach(library.refs, manual) : undefined), [library, manual]);

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
    for (const [id, m] of Object.entries(manual)) if (!same(m, NEUTRAL_MANUAL)) update(id, NEUTRAL_MANUAL);
  }, [manual, update]);

  if (!library || !weights || !byApproach) return { loading: status === "online" && !error, error };
  const records = Object.fromEntries(library.records.map((r) => [r.id, r]));
  const view: LibraryView = {
    source: "local",
    refs: library.refs,
    weights,
    zones: weights.zones,
    byApproach,
    manual,
    update,
    reset,
    changed: Object.values(manual).some((m) => !same(m, NEUTRAL_MANUAL)),
    // 自分の映像の値は、次の段階（M2-3）でこの分布と比べる
    you: () => undefined,
    local: {
      records,
      refresh: async (id) => {
        await lib!.refreshReference(id);
        await load();
      },
      remove: async (id) => {
        await lib!.deleteReference(id);
        await load();
      },
    },
  };
  return { view, loading: false, error, library };
}
