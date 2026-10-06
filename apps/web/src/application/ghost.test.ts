import { describe, expect, it } from "vitest";
import type { AnalyzedRep, Reference } from "../domain/entities";
import type { Approach } from "../domain/throws";
import { NEUTRAL_MANUAL } from "./references";
import { compareMetrics, ghostCandidates } from "./ghost";

const rep = (id: string, approach?: Approach): AnalyzedRep => ({
  id,
  index: 1,
  seq: { fps: 60, heightM: 1.9, frames: [] },
  events: { setStart: 0, strideStart: 10, plant: 20, release: 25, followStart: 30, last: 40 },
  phases: [],
  metrics: {},
  rotation: [],
  approach,
});

const ref = (id: string, camera: "side" | "behind", reps: AnalyzedRep[]) =>
  ({ id, title: id, stats: { camera }, reps }) as unknown as Reference;

describe("重ねるお手本を選ぶ", () => {
  const refs = [
    ref("heavy-standing", "side", [rep("a", "standing")]),
    ref("light-drop", "side", [rep("b1", "standing"), rep("b2", "drop")]),
    ref("behind", "behind", [rep("c", "drop")]),
    ref("excluded-drop", "side", [rep("d", "drop")]),
  ];
  const weights = { "heavy-standing": 0.3, "light-drop": 0.1, behind: 0.5, "excluded-drop": 0.4 };
  const manual = { "excluded-drop": { ...NEUTRAL_MANUAL, excluded: true } };

  it("横から撮ったお手本だけを使い、除外したものは使わない", () => {
    expect(ghostCandidates(refs, weights, manual, "drop").map((c) => c.ref.id)).toEqual(["light-drop", "heavy-standing"]);
  });

  it("投げ始めが同じお手本を先に、その中で重みの高い順に並べる。レップも投げ始めが同じものを選ぶ", () => {
    const [first] = ghostCandidates(refs, weights, manual, "drop");
    expect(first).toMatchObject({ sameApproach: true, weight: 0.1 });
    expect(first!.rep.id).toBe("b2");
  });

  it("投げ始めが分からなければ、重みの高い順", () => {
    const cs = ghostCandidates(refs, weights, manual, "unknown");
    expect(cs.map((c) => [c.ref.id, c.sameApproach])).toEqual([
      ["heavy-standing", false],
      ["light-drop", false],
    ]);
    expect(cs[1]!.rep.id).toBe("b1");
  });
});

describe("自分とお手本の指標を並べる", () => {
  it("どちらかで測れた指標を並べ、差と、自分の値のお手本ゾーンでの判定を付ける", () => {
    const zone = { p10: 0.38, p25: 0.42, p50: 0.45, p75: 0.48, p90: 0.52 };
    const rows = compareMetrics({ strideRatio: 0.45, headStability: 9 }, { strideRatio: 0.41, elbowAngle: 120 }, { strideRatio: zone });
    expect(rows.map((r) => [r.key, r.diff === undefined ? undefined : +r.diff.toFixed(2), r.status])).toEqual([
      ["strideRatio", 0.04, "good"],
      ["elbowAngle", undefined, "na"],
      ["headStability", undefined, "na"],
    ]);
  });
});
