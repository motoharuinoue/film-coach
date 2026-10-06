import { describe, expect, it } from "vitest";
import { evaluateMetric, type Zone } from "../../domain/judgement";
import { TemplateFindingWriter } from "./templateFindingWriter";

const zone: Zone = { p10: 0.38, p25: 0.42, p50: 0.45, p75: 0.48, p90: 0.52 };
const writer = new TemplateFindingWriter();

describe("改善点の文章は、お手本の範囲のどちら側に外れたかで書き分ける（大きいほど良い、とは書かない）", () => {
  it("ステップ幅は、狭すぎても広すぎても、それぞれの理由を書く", () => {
    expect(writer.write(evaluateMetric("strideRatio", 0.36, undefined, zone)).title).toBe("ステップ幅がお手本の範囲より狭い");
    const wide = writer.write(evaluateMetric("strideRatio", 0.56, undefined, zone));
    expect(wide.title).toBe("ステップ幅がお手本の範囲より広い");
    expect(wide.body).toContain("0.42〜0.48");
  });

  it("肘の高さは、下がりすぎも上がりすぎも書き分ける", () => {
    const z: Zone = { p10: -2, p25: 2, p50: 6, p75: 10, p90: 14 };
    expect(writer.write(evaluateMetric("elbowHeight", -8, undefined, z)).title).toBe("リリースで肘が下がっている");
    expect(writer.write(evaluateMetric("elbowHeight", 20, undefined, z)).title).toBe("リリースで肘が上がりすぎている");
  });

  it("ほかの指標は、範囲より大きいか小さいかを書き、範囲に入るかを見ていると添える", () => {
    const z: Zone = { p10: 0.9, p25: 0.95, p50: 1.0, p75: 1.05, p90: 1.1 };
    const high = writer.write(evaluateMetric("releaseHeight", 1.2, undefined, z));
    expect(high.title).toBe("リリース高がお手本の範囲より大きい");
    expect(high.body).toContain("この範囲に入るか");
  });
});
