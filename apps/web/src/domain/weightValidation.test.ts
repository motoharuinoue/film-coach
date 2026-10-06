import { describe, expect, it } from "vitest";
import { SCHEMES, schemeWeight, validateWeighting, type Scheme, type ValidationGroup } from "./weightValidation";
import type { ReferenceStats } from "./weighting";

const stats = (s: Partial<ReferenceStats> = {}): ReferenceStats => ({
  views: 50_000,
  likes: 1_500,
  subscribers: 20_000,
  trustedChannel: false,
  camera: "side",
  resolution: 1080,
  fps: 60,
  confidence: 0.9,
  ...s,
});

const ok = { pinned: false, excluded: false, stars: 3 as const };

const group = (id: string, values: number[], s: Partial<ReferenceStats> = {}): ValidationGroup => ({
  id,
  samples: values.map((v, i) => ({ id: `${id}#${i}`, stats: stats(s), manual: ok, metrics: { strideRatio: v } })),
});

// ステップ幅が 0.50〜0.56 にまとまったお手本 6 本（1 本に 3 レップ）
const library = [0.5, 0.51, 0.52, 0.53, 0.55, 0.56].map((v, i) => group(`r${i}`, [v - 0.004, v, v + 0.004], { views: 20_000 * (i + 1) }));

describe("schemeWeight", () => {
  const parts = { P: 0.6, C: 0.5, Q: 0.8, K: 0.5, M: 1, w: 0.12 };

  it("付け方ごとに、使う要素だけを掛ける", () => {
    expect(schemeWeight(parts, "full")).toBe(0.12);
    expect(schemeWeight(parts, "noConsensus")).toBeCloseTo(0.24);
    expect(schemeWeight(parts, "popularity")).toBe(0.6);
    expect(schemeWeight(parts, "uniform")).toBe(1);
  });

  it("撮影の角度が合わない標本と、除外した標本は、どの付け方でも使わない", () => {
    for (const s of SCHEMES) {
      expect(schemeWeight({ ...parts, Q: 0 }, s)).toBe(0);
      expect(schemeWeight({ ...parts, M: 0 }, s)).toBe(0);
    }
  });
});

describe("validateWeighting", () => {
  it("同じシードなら同じ結果になる", () => {
    const a = validateWeighting(library, { iterations: 200, seed: 7 });
    const b = validateWeighting(library, { iterations: 200, seed: 7 });
    expect(a).toEqual(b);
  });

  it("お手本がすべて同じ値なら、揺れもずれも測れないので指標に含めない", () => {
    const same = [0, 1, 2, 3].map((i) => group(`s${i}`, [0.5]));
    expect(validateWeighting(same, { iterations: 50 }).metrics).toEqual([]);
  });

  it("指標を測れたお手本が 3 本未満なら含めない", () => {
    expect(validateWeighting(library.slice(0, 2), { iterations: 50 }).metrics).toEqual([]);
    expect(validateWeighting(library.slice(0, 3), { iterations: 50 }).metrics.map((m) => m.metric)).toEqual(["strideRatio"]);
  });

  it("撮影の角度が合わないお手本は、本数にも値の幅にも数えない", () => {
    const behind = group("behind", [0.9, 0.9, 0.9], { camera: "behind" });
    const r = validateWeighting([...library, behind], { iterations: 50 }).metrics[0]!;
    expect(r.groups).toBe(6);
    expect(r.range).toBeCloseTo(0.564 - 0.496);
  });

  it("人気の高い外れ値によるずれは、一致度 K で小さくなる", () => {
    const shift = validateWeighting(library, { iterations: 50 }).metrics[0]!.shift[0]!;
    expect(shift.full).toBeLessThan(shift.popularity);
    expect(shift.full).toBeLessThan(shift.noConsensus / 1.5);
  });

  it("外れ値が遠いほど、一致度 K で強く下がる（ほかの付け方では、ずれは距離によらない）", () => {
    const [near, far] = validateWeighting(library, { iterations: 50, outlierDistances: [1, 3] }).metrics[0]!.shift as [Record<Scheme, number>, Record<Scheme, number>];
    expect(far.full).toBeLessThan(near.full / 2);
    expect(far.full).toBeLessThan(far.uniform / 2);
    expect(far.uniform).toBeCloseTo(near.uniform);
  });

  it("揺れとずれは、お手本の値の幅に対する割合で返す", () => {
    const r = validateWeighting(library, { iterations: 200 });
    const m = r.metrics[0]!;
    for (const s of SCHEMES) {
      expect(m.spread[s]).toBeGreaterThan(0);
      expect(m.spread[s]).toBeLessThan(1);
      expect(r.mean.spread[s]).toBeCloseTo(m.spread[s]);
    }
  });
});
