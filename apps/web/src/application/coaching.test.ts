import { describe, expect, it, vi } from "vitest";
import type { AnalyzedRep } from "../domain/entities";
import { evaluateMetric, type Zone } from "../domain/judgement";
import { buildFindings } from "./coaching";
import type { FindingWriter, ReferenceRepository } from "./ports";

// ポートを差し替えられることの確認：ライターとリポジトリはスタブで足りる
const zone: Zone = { p10: 0.46, p25: 0.5, p50: 0.52, p75: 0.54, p90: 0.58 };
const rep = { events: { setStart: 30, strideStart: 45, plant: 60, release: 66, followStart: 70, last: 100 } } as AnalyzedRep;

const references: ReferenceRepository = {
  list: () => [],
  get: () => undefined,
  // 小さい側（ステップが狭い）を直すドリルだけを返す
  drillFor: (key, side) => (key === "strideRatio" && side === "low" ? { label: "ステップ・アンド・スロー", channel: "QB Lab", at: "2:14", youtubeId: "Qb7Drill_01", startSec: 134 } : undefined),
};

describe("buildFindings", () => {
  it("文章はライターに任せ、ドリルと根拠のフレームと目標を付ける", () => {
    const writer: FindingWriter = { write: vi.fn(() => ({ title: "タイトル", body: "本文" })) };
    const [f] = buildFindings(rep, [evaluateMetric("strideRatio", 0.44, 0.52, zone)], writer, references);
    expect(writer.write).toHaveBeenCalledOnce();
    expect(f).toMatchObject({
      key: "strideRatio",
      severity: "flag",
      title: "タイトル",
      body: "本文",
      target: "0.50〜0.54",
      drill: { label: "ステップ・アンド・スロー", channel: "QB Lab", at: "2:14", youtubeId: "Qb7Drill_01" },
      frame: rep.events.plant,
    });
  });

  it("ドリルが見つからない指標は drill なし", () => {
    const writer: FindingWriter = { write: () => ({ title: "", body: "" }) };
    const [f] = buildFindings(rep, [evaluateMetric("elbowHeight", 5, undefined, { p10: 10, p25: 13, p50: 15, p75: 17, p90: 19 })], writer, references);
    expect(f!.drill).toBeUndefined();
    expect(f!.frame).toBe(rep.events.release);
  });
});
