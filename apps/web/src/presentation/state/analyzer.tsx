// 解析サービスにつながっているかを全画面で共有する。つながらないときは 10 秒ごとに確かめ直す。

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { FootageLibrary } from "../../application/ports";
import { useServices } from "../services";

export type AnalyzerStatus = "none" | "checking" | "online" | "offline";

type Ctx = { lib?: FootageLibrary; status: AnalyzerStatus; modelsReady: boolean; recheck: () => void };

const AnalyzerContext = createContext<Ctx | null>(null);

export function AnalyzerProvider({ children }: { children: ReactNode }) {
  const { footage } = useServices();
  const [status, setStatus] = useState<AnalyzerStatus>(footage ? "checking" : "none");
  const [modelsReady, setModelsReady] = useState(false);

  const recheck = useCallback(() => {
    if (!footage) return;
    footage
      .health()
      .then((h) => {
        setStatus(h.ok ? "online" : "offline");
        setModelsReady(h.modelsReady);
      })
      .catch(() => setStatus("offline"));
  }, [footage]);

  useEffect(() => {
    recheck();
  }, [recheck]);
  useEffect(() => {
    if (status !== "offline") return;
    const t = setInterval(recheck, 10_000);
    return () => clearInterval(t);
  }, [status, recheck]);

  return <AnalyzerContext.Provider value={{ lib: footage, status, modelsReady, recheck }}>{children}</AnalyzerContext.Provider>;
}

export function useAnalyzer(): Ctx {
  const c = useContext(AnalyzerContext);
  if (!c) throw new Error("AnalyzerProvider がありません");
  return c;
}
