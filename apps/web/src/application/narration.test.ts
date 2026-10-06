import { describe, expect, it, vi } from "vitest";
import { evaluateMetric, type Zone } from "../domain/judgement";
import type { Finding } from "./coaching";
import { narrate, narrationInput, numbersIn, unexpectedNumbers } from "./narration";
import type { FindingNarrator } from "./ports";

const zone: Zone = { p10: 3, p25: 5, p50: 7, p75: 9, p90: 11 };
const finding: Finding = {
  key: "trunkTilt",
  severity: "caution",
  title: "前傾がお手本の範囲より小さい",
  body: "リリース時の体幹の前傾が -2° で、お手本ゾーン（5〜9°）より小さくなっています。",
  target: "5〜9°",
  frame: 50,
  evaluation: evaluateMetric("trunkTilt", -1.6, 4.2, zone),
};

const narrator = (out: { title: string; body: string } | Error): FindingNarrator => ({
  model: "gemma3:12b",
  version: "test",
  status: async () => ({ ok: true }),
  write: vi.fn(async () => {
    if (out instanceof Error) throw out;
    return out;
  }),
});

describe("LLM に渡す材料", () => {
  it("数値は指標の桁数にそろえ、外れた側と自己ベスト、下書きを添える", () => {
    expect(narrationInput(finding)).toEqual({
      metric: "リリース時の体幹の前傾",
      hint: "腰と肩を結ぶ線と、鉛直線のなす角度",
      unit: "°",
      value: "-2°",
      zone: { low: "5°", high: "9°" },
      side: "low",
      severity: "caution",
      best: "4°",
      draft: { title: finding.title, body: finding.body },
    });
  });
});

describe("数値の確かめ方", () => {
  const input = narrationInput(finding);

  it("全角の数字も半角にそろえて取り出す（符号は見ない）", () => {
    expect(numbersIn("前傾が −２° で、５〜9.5° の範囲")).toEqual(["2", "5", "9.5"]);
  });

  it("判定結果の値（自分の値・お手本ゾーン・自己ベスト）だけなら問題なし", () => {
    expect(unexpectedNumbers("前傾が -2° で、お手本の 5〜9° より小さく、自己ベストの 4° にも届いていません。", input)).toEqual([]);
  });

  it("判定結果にない数値（回数・目安など）は見つける", () => {
    expect(unexpectedNumbers("前傾を 10° くらいにして、3 回ずつ練習しましょう。", input)).toEqual(["10", "3"]);
  });
});

describe("文章にする", () => {
  it("数値が判定結果のものだけなら、LLM の文章を使う", async () => {
    const n = await narrate(narrator({ title: " 上体をもう少し前へ ", body: "前傾が -2° で、お手本の 5〜9° より小さいです。" }), finding);
    expect(n).toEqual({ title: "上体をもう少し前へ", body: "前傾が -2° で、お手本の 5〜9° より小さいです。", source: "llm", model: "gemma3:12b" });
  });

  it("判定結果にない数値が入っていたら、テンプレートの文章に戻して理由を添える", async () => {
    const n = await narrate(narrator({ title: "前傾を作る", body: "あと 7° 前に倒しましょう。" }), finding);
    expect(n).toMatchObject({ title: finding.title, body: finding.body, source: "template", checked: true });
    expect(n.reason).toContain("判定結果にない数値（7）");
  });

  it("ドリル動画を渡していないのに、ドリルや動画に触れていたら、テンプレートの文章に戻す", async () => {
    const n = await narrate(narrator({ title: "前傾が小さい", body: "「上体を倒すドリル」の動画を見てみましょう。" }), finding);
    expect(n).toMatchObject({ source: "template", checked: true });
    expect(n.reason).toContain("ドリル動画");
    const withDrill = { ...finding, drill: { label: "投げ終わりまで体を運ぶ", channel: "TeamSnap", at: "0:00" } };
    expect((await narrate(narrator({ title: "前傾が小さい", body: "ドリル動画「投げ終わりまで体を運ぶ」で確かめましょう。" }), withDrill)).source).toBe("llm");
  });

  it("LLM がない・失敗した・空のときも、テンプレートの文章", async () => {
    expect(await narrate(undefined, finding)).toEqual({ title: finding.title, body: finding.body, source: "template", reason: undefined });
    expect((await narrate(narrator(new Error("つながりません")), finding)).reason).toContain("つながりません");
    expect((await narrate(narrator({ title: "", body: "" }), finding)).source).toBe("template");
  });
});
