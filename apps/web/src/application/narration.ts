// ユースケース：改善点の文章を、手元の LLM（Ollama）に書いてもらう（ADR-0003）。
// 判定（どの指標が、お手本の範囲のどちら側に、どれだけ外れたか）はルールエンジンが決め、LLM は文章にするだけ。
// LLM の文章を次の 2 つで確かめ、合わなければテンプレートの文章に戻す（材料にないことを書かせない）。
// - 数値が、判定結果の値（自分の値・お手本ゾーン・自己ベスト）だけか
// - ドリル動画を渡していないのに、ドリルや動画に触れていないか（存在しないドリル動画を挙げない）

import { METRIC_BY_KEY, unitSuffix } from "../domain/metrics";
import { outside } from "../domain/judgement";
import type { Finding } from "./coaching";
import type { FindingNarrator, NarrationInput } from "./ports";

export type Narration = {
  title: string;
  body: string;
  /** llm：LLM の文章、template：テンプレートの文章（LLM がない・失敗した・数値が合わない） */
  source: "llm" | "template";
  model?: string;
  /** テンプレートに戻した理由 */
  reason?: string;
  /** LLM の文章を確かめて、合わずにテンプレートに戻したか（同じ材料なら同じ結果になりやすいので覚えておく） */
  checked?: boolean;
};

/** 改善点から、LLM に渡す材料を作る。数値は指標の桁数にそろえた文字列で渡す */
export function narrationInput(f: Finding): NarrationInput {
  const d = METRIC_BY_KEY[f.key];
  const e = f.evaluation;
  const fmt = (v: number) => `${v.toFixed(d.digits)}${unitSuffix(d.unit)}`;
  return {
    metric: d.label,
    hint: d.hint,
    unit: d.unit,
    value: fmt(e.value!),
    zone: { low: fmt(e.zone!.p25), high: fmt(e.zone!.p75) },
    side: outside(e.value, e.zone) ?? "low",
    severity: f.severity,
    best: e.best !== undefined ? fmt(e.best) : undefined,
    drill: f.drill?.label,
    draft: { title: f.title, body: f.body },
  };
}

/** 文章の中の数値（全角も半角にそろえる。符号は見ない） */
export function numbersIn(text: string): string[] {
  return [...text.normalize("NFKC").matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]);
}

/** 使ってよい数値（材料に入れた値）以外の数値。表記の桁が違っても、その桁で同じなら使ってよいとみなす */
export function unexpectedNumbers(text: string, input: NarrationInput): string[] {
  const allowed = [input.value, input.zone.low, input.zone.high, ...(input.best ? [input.best] : [])].flatMap(numbersIn).map(Number);
  return numbersIn(text).filter((s) => {
    const n = Number(s);
    const decimals = s.includes(".") ? s.split(".")[1]!.length : 0;
    return !allowed.some((a) => Math.abs(n - a) < 0.5 * 10 ** -decimals);
  });
}

/** 材料にないものへの言及。いまはドリル動画（渡していないのに、ドリルや動画を挙げている） */
export function unexpectedMentions(text: string, input: NarrationInput): string[] {
  return !input.drill && /ドリル|動画/.test(text) ? ["ドリル動画"] : [];
}

/** LLM に書いてもらい、確かめる。使えない・失敗した・数値や言及が合わないときはテンプレートの文章 */
export async function narrate(narrator: FindingNarrator | undefined, f: Finding, signal?: AbortSignal): Promise<Narration> {
  const template = (reason?: string): Narration => ({ title: f.title, body: f.body, source: "template", reason });
  if (!narrator) return template();
  const input = narrationInput(f);
  try {
    const out = await narrator.write(input, signal);
    const bad = unexpectedNumbers(`${out.title} ${out.body}`, input);
    if (bad.length) return { ...template(`判定結果にない数値（${bad.join("、")}）が入っていたため、テンプレートの文章にしました`), checked: true };
    if (unexpectedMentions(`${out.title} ${out.body}`, input).length) return { ...template("登録されていないドリル動画に触れていたため、テンプレートの文章にしました"), checked: true };
    if (!out.title.trim() || !out.body.trim()) return template("文章が空だったため、テンプレートの文章にしました");
    return { title: out.title.trim(), body: out.body.trim(), source: "llm", model: narrator.model };
  } catch (e) {
    if (signal?.aborted) throw e;
    return template(`LLM で文章にできなかったため、テンプレートの文章にしました（${(e as Error).message}）`);
  }
}
