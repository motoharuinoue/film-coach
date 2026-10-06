// FindingNarrator の Ollama 実装。手元の Ollama（http://127.0.0.1:11434）の chat API で、改善点の文章を書いてもらう。
// 出力は JSON（title・body）に限る（structured outputs）。数値の確認は application/narration.ts で行う。

import type { FindingNarrator, NarrationInput } from "../../application/ports";

const SIDE_LABEL = { low: "お手本の範囲より小さい", high: "お手本の範囲より大きい" } as const;

export const SYSTEM_PROMPT = `あなたはアメリカンフットボールのクォーターバック（QB）のコーチです。選手本人に向けて、投球フォームの改善点を日本語で伝えます。

次のことを必ず守ってください。
- 判定はすでに決まっています。判定を変えたり、ほかの問題を付け足したりしないでください。
- 数値は「使ってよい数値」に挙がったものだけを、単位を付けてそのまま使ってください。それ以外の数字（回数、割合、目安の角度や距離など）は一切書かないでください。
- 指標は「大きいほど良い」「小さいほど良い」ものではありません。お手本の範囲との関係（範囲より小さい・大きい）で書いてください。
- 原因の推測や、下書きにない体の動かし方・練習方法は書かないでください。直し方は「お手本の範囲に近づける」意識と、ドリル動画があればその名前だけで示してください。
- 横から撮った 2D の映像からの推定です。言い切りすぎないでください。
- タイトルは、どの指標がお手本の範囲のどちら側に外れたかが分かるように、30 字以内で書いてください。
- 本文は 2〜3 文で 120 字以内、です・ます調で書いてください。
- 出力は JSON（title と body）だけにしてください。`;

/** 指示文の版。指示を変えたら上げる（画面が覚えた文章を書き直す） */
export const PROMPT_VERSION = "3";

/** 改善点の材料を、LLM に渡す文面にする */
export function userPrompt(input: NarrationInput): string {
  const nums = [input.value, input.zone.low, input.zone.high, ...(input.best ? [input.best] : [])];
  return [
    `指標：${input.metric}（${input.hint}）`,
    `判定：${input.severity === "flag" ? "要改善" : "注意"}（${SIDE_LABEL[input.side]}）`,
    `自分の値：${input.value}`,
    `お手本の範囲：${input.zone.low}〜${input.zone.high}`,
    ...(input.best ? [`自己ベストのときの値：${input.best}`] : []),
    input.drill ? `ドリル動画：${input.drill}` : "ドリル動画：なし（ドリルや動画には触れないでください）",
    `使ってよい数値：${nums.join("、")}`,
    `下書きのタイトル：${input.draft.title}`,
    `下書きの本文：${input.draft.body}`,
  ].join("\n");
}

const FORMAT = {
  type: "object",
  properties: { title: { type: "string" }, body: { type: "string" } },
  required: ["title", "body"],
} as const;

export class OllamaNarrator implements FindingNarrator {
  readonly version = PROMPT_VERSION;

  constructor(
    private readonly baseUrl: string,
    readonly model: string,
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
  ) {}

  async status() {
    try {
      const res = await this.fetchFn(`${this.baseUrl}/api/tags`);
      if (!res.ok) return { ok: false, reason: `Ollama の応答が ${res.status} でした` };
      const tags = (await res.json()) as { models?: { name: string }[] };
      const names = (tags.models ?? []).map((m) => m.name);
      const found = names.some((n) => n === this.model || n === `${this.model}:latest`);
      return found ? { ok: true } : { ok: false, reason: `モデル ${this.model} がありません（ollama pull ${this.model}）` };
    } catch {
      return { ok: false, reason: "Ollama につながりません（ollama serve で起動してください）" };
    }
  }

  async write(input: NarrationInput, signal?: AbortSignal) {
    const res = await this.fetchFn(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model: this.model,
        stream: false,
        format: FORMAT,
        // 言い回しの揺れを小さくする。モデルは 10 分だけ読み込んだままにする（続けて書くときに速い）
        options: { temperature: 0.2 },
        keep_alive: "10m",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt(input) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Ollama の応答が ${res.status} でした`);
    const data = (await res.json()) as { message?: { content?: string } };
    const out = JSON.parse(data.message?.content ?? "{}") as { title?: unknown; body?: unknown };
    return { title: typeof out.title === "string" ? out.title : "", body: typeof out.body === "string" ? out.body : "" };
  }
}
