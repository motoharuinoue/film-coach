// 解析サービスにつながっていないときの案内。公開デモ（解析サービスなし）と、手元で止まっているときを分ける。

import { IconLoader2, IconPlugConnectedX, IconRefresh, IconShieldLock } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Button, Card } from "../../components/ui";
import { useAnalyzer } from "../../state/analyzer";

function Commands() {
  return (
    <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-ink p-3 font-mono text-xs leading-relaxed text-text/90">
      {`# 1. 解析サービス（初回だけモデルを取得、約 145 MB）
cd services/analyzer
uv run film-coach models download
uv run film-coach serve

# 2. 画面（別のターミナルで）
npm run dev   # http://localhost:5173`}
    </pre>
  );
}

/** 解析サービスにつながっていれば children を出し、そうでなければ案内を出す */
export function AnalyzerGate({ children }: { children: ReactNode }) {
  const { status, modelsReady, recheck } = useAnalyzer();

  if (status === "online") {
    return (
      <>
        {!modelsReady && (
          <Card className="mb-4 border-caution/30 bg-caution/[0.05] p-4 text-sm text-caution">
            骨格推定のモデルがまだありません。`uv run film-coach models download` を実行してください。
          </Card>
        )}
        {children}
      </>
    );
  }
  if (status === "checking") {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-muted">
        <IconLoader2 size={18} className="animate-spin" aria-hidden />
        解析サービスへの接続を確かめています…
      </div>
    );
  }
  return (
    <Card className="max-w-2xl p-6">
      {status === "none" ? (
        <>
          <div className="flex items-center gap-2 text-text">
            <IconShieldLock size={20} className="text-ice" aria-hidden />
            <h2 className="font-semibold">自分の映像は、手元の解析サービスで扱います</h2>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            この公開デモには解析サービスがないので、デモデータ（架空）で動いています。自分の映像を解析するときは、リポジトリを手元にクローンして、次のように起動します。映像は手元から外に出ません。
          </p>
          <Commands />
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 text-text">
            <IconPlugConnectedX size={20} className="text-flag" aria-hidden />
            <h2 className="font-semibold">解析サービスにつながりません</h2>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted">手元の解析サービスが動いていないようです。起動すると、10 秒以内に自動でつながります。</p>
          <Commands />
          <Button className="mt-4" onClick={recheck}>
            <IconRefresh size={15} aria-hidden /> もう一度確かめる
          </Button>
        </>
      )}
    </Card>
  );
}
