// お手本ライブラリの画面が使う一式：お手本・重み・手動調整・分布に重ねる自分の値。
// デモ（合成データ、手動調整はブラウザに保存）と、手元のお手本（解析サービス、手動調整も解析サービスに保存）の 2 つがある。

import { useMemo } from "react";
import type { LocalLibrary } from "../../application/localReferences";
import { NEUTRAL_MANUAL, zoneSetOf, type ReferenceWeights } from "../../application/references";
import type { Reference } from "../../domain/entities";
import { EMPTY_ZONE_SET, type ZoneSet, type Zones } from "../../domain/judgement";
import { isValidFor, METRIC_BY_KEY, type MetricKey, type MetricValues } from "../../domain/metrics";
import type { LocalReference } from "../../domain/reference";
import type { ApproachGroup } from "../../domain/throws";
import type { ManualAdjust } from "../../domain/weighting";
import { useAnalyzer } from "./analyzer";
import { useBenchmarks, useDemoCoach } from "./benchmarks";
import { useLocalData } from "./local";

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
  const { coach, bench } = useDemoCoach();
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

/** 手元のお手本（LocalDataProvider が読んだもの）。解析サービスにつながっていなければ view は undefined */
export function useLocalLibrary(): { view?: LibraryView; loading: boolean; error?: string; library?: LocalLibrary } {
  const { lib } = useAnalyzer();
  const { library, manual, weights, byApproach, update, reset, reload, loading, error } = useLocalData();
  const view = useMemo((): LibraryView | undefined => {
    if (!library || !weights || !byApproach) return undefined;
    return {
      source: "local",
      refs: library.refs,
      weights,
      zones: weights.zones,
      byApproach,
      manual,
      update,
      reset,
      changed: Object.values(manual).some((m) => !same(m, NEUTRAL_MANUAL)),
      // 自分の映像の値は、「見る」・練習の画面でこの分布と比べる
      you: () => undefined,
      local: {
        records: Object.fromEntries(library.records.map((r) => [r.id, r])),
        refresh: async (id) => {
          await lib!.refreshReference(id);
          await reload();
        },
        remove: async (id) => {
          await lib!.deleteReference(id);
          await reload();
        },
      },
    };
  }, [library, weights, byApproach, manual, update, reset, reload, lib]);
  return { view, loading: !view && loading, error, library };
}
