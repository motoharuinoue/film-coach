import { describe, expect, it, vi } from "vitest";
import type { NarrationInput } from "../../application/ports";
import { OllamaNarrator, userPrompt } from "./ollamaNarrator";

const input: NarrationInput = {
  metric: "リリース時の体幹の前傾",
  hint: "腰と肩を結ぶ線と、鉛直線のなす角度",
  unit: "°",
  value: "-2°",
  zone: { low: "5°", high: "9°" },
  side: "low",
  severity: "caution",
  best: "4°",
  draft: { title: "前傾がお手本の範囲より小さい", body: "下書き" },
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

describe("Ollama で改善点の文章を書く", () => {
  it("使ってよい数値と、外れた側を、文面で渡す", () => {
    const p = userPrompt(input);
    expect(p).toContain("使ってよい数値：-2°、5°、9°、4°");
    expect(p).toContain("判定：注意（お手本の範囲より小さい）");
    expect(p).toContain("下書きの本文：下書き");
    expect(p).toContain("ドリル動画：なし（ドリルや動画には触れないでください）");
    expect(userPrompt({ ...input, drill: "投げ終わりまで体を運ぶ" })).toContain("ドリル動画：投げ終わりまで体を運ぶ");
  });

  it("chat API に JSON の形を指定して頼み、title と body を返す", async () => {
    const fetchFn = vi.fn(async () => json({ message: { content: JSON.stringify({ title: "上体を前へ", body: "本文" }) } }));
    const n = new OllamaNarrator("http://127.0.0.1:11434", "gemma3:12b", fetchFn as unknown as typeof fetch);
    expect(await n.write(input)).toEqual({ title: "上体を前へ", body: "本文" });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: "gemma3:12b", stream: false, format: { required: ["title", "body"] } });
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user"]);
  });

  it("モデルがあるか、Ollama につながるかを確かめる", async () => {
    const tags = (names: string[]) => vi.fn(async () => json({ models: names.map((name) => ({ name })) })) as unknown as typeof fetch;
    expect(await new OllamaNarrator("u", "gemma3:12b", tags(["gemma3:12b"])).status()).toEqual({ ok: true });
    expect((await new OllamaNarrator("u", "gemma3:12b", tags(["qwen3:8b"])).status()).reason).toContain("ollama pull gemma3:12b");
    const down = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect((await new OllamaNarrator("u", "gemma3:12b", down).status()).reason).toContain("ollama serve");
  });

  it("応答が失敗なら、理由を付けて失敗にする", async () => {
    const n = new OllamaNarrator("u", "gemma3:12b", vi.fn(async () => json({ error: "x" }, 500)) as unknown as typeof fetch);
    await expect(n.write(input)).rejects.toThrow("500");
  });
});
