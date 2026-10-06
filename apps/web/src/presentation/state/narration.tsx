// 改善点の文章を、手元の LLM（Ollama）で書いてもらう。
// 書いた文章はブラウザに覚えておき、同じ材料（指標・値・お手本ゾーン・下書き）なら書き直さない。
// Ollama が使えなければ、テンプレートの文章をそのまま出す。

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Finding } from "../../application/coaching";
import { narrate, narrationInput, type Narration } from "../../application/narration";
import type { FindingNarrator } from "../../application/ports";
import { useServices } from "../services";

type Ctx = { narrator?: FindingNarrator; ok: boolean; reason?: string };

const NarratorContext = createContext<Ctx>({ ok: false });

export function NarratorProvider({ children }: { children: ReactNode }) {
  const { narrator } = useServices();
  const [state, setState] = useState<Ctx>({ narrator, ok: false });
  useEffect(() => {
    if (!narrator) return;
    void narrator.status().then((s) => setState({ narrator, ok: s.ok, reason: s.reason }));
  }, [narrator]);
  return <NarratorContext.Provider value={state}>{children}</NarratorContext.Provider>;
}

export function useNarrator(): Ctx {
  return useContext(NarratorContext);
}

// 同じ材料の書き直しを、画面をまたいで 1 回にまとめる
const inflight = new Map<string, Promise<Narration>>();

function hash(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function load(key: string): Narration | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Narration) : undefined;
  } catch {
    return undefined;
  }
}

/** 改善点の文章。LLM が書くまではテンプレートの文章（pending）。LLM がなければテンプレートのまま */
export function useNarration(f: Finding | undefined): { narration?: Narration; pending: boolean } {
  const { narrator, ok } = useNarrator();
  const key = f && narrator ? `film-coach:narration:${narrator.model}:v${narrator.version}:${hash(JSON.stringify(narrationInput(f)))}` : undefined;
  const [result, setResult] = useState<{ key: string; narration: Narration }>();

  useEffect(() => {
    if (!f || !key || !ok) return;
    const cached = load(key);
    if (cached) {
      setResult({ key, narration: cached });
      return;
    }
    let alive = true;
    const job = inflight.get(key) ?? narrate(narrator, f);
    inflight.set(key, job);
    void job.then((n) => {
      inflight.delete(key);
      // LLM の文章と、確かめて合わずテンプレートに戻したものだけ覚える（つながらなかったときは次に書き直す）
      if (n.source === "llm" || n.checked) {
        try {
          localStorage.setItem(key, JSON.stringify(n));
        } catch {
          // 覚えられなくても表示は続ける
        }
      }
      if (alive) setResult({ key, narration: n });
    });
    return () => {
      alive = false;
    };
    // f は key（材料のハッシュ）が同じなら同じ内容なので、key で読み直す
  }, [key, ok, narrator]);

  const narration = result && result.key === key ? result.narration : undefined;
  return { narration, pending: ok && !!f && !narration };
}

/** 改善点の文章がどこから来たか（LLM・書いている途中・テンプレート） */
export function NarrationSource({ narration, pending, className }: { narration?: Narration; pending: boolean; className?: string }) {
  const { narrator, ok } = useNarrator();
  if (!narrator || !ok) return null;
  const text = pending
    ? `文章を書いています…（${narrator.model}）`
    : narration?.source === "llm"
      ? `文章：手元の LLM（${narration.model}）。数値は判定結果と、ドリル動画は登録済みのものと照合済みです`
      : (narration?.reason ?? "文章：テンプレート");
  return <p className={className ?? "no-print mt-1.5 text-[10px] text-faint"}>{text}</p>;
}
