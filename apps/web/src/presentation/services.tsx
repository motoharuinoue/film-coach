// プレゼンテーション層へのサービスの受け渡し。画面はここから CoachService を受け取り、
// infrastructure を直接 import しない。

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Benchmarks, Services } from "../application/coach";

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({ services, children }: { services: Services; children: ReactNode }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const s = useContext(ServicesContext);
  if (!s) throw new Error("ServicesProvider がありません");
  return s;
}

/** 既定の手動調整での基準（お手本ゾーンと自己ベスト） */
export function useDefaultBenchmarks(): Benchmarks {
  const { coach } = useServices();
  return useMemo(() => coach.benchmarks(), [coach]);
}
