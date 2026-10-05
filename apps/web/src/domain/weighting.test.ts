import { describe, expect, it } from "vitest";
import { computeWeights, consensus, manual, popularity, quality, weightedQuantile, type ReferenceStats } from "./weighting";

const stats = (s: Partial<ReferenceStats> = {}): ReferenceStats => ({
  views: 100_000,
  likes: 4_000,
  subscribers: 50_000,
  trustedChannel: false,
  camera: "side",
  resolution: 1080,
  fps: 60,
  confidence: 0.9,
  ...s,
});

describe("weightedQuantile", () => {
  it("重みが等しければ通常の中央値になる", () => {
    expect(weightedQuantile([1, 2, 3], [1, 1, 1], 0.5)).toBeCloseTo(2);
  });

  it("重い点に引き寄せられる", () => {
    expect(weightedQuantile([1, 2, 3], [1, 1, 8], 0.5)!).toBeGreaterThan(2.5);
  });

  it("重み 0 の点は無視し、有効な点がなければ undefined", () => {
    expect(weightedQuantile([1, 100], [1, 0], 0.5)).toBe(1);
    expect(weightedQuantile([1, 2], [0, 0], 0.5)).toBeUndefined();
  });
});

describe("popularity", () => {
  it("再生数の少ない動画の高評価率はベイズ平均で事前分布に寄せる", () => {
    const tiny = popularity(stats({ views: 50, likes: 25 })); // 生の高評価率 50%
    expect(tiny.bayesRate).toBeLessThan(0.04);
  });

  it("高評価率と再生数が同じなら、再生数が多いほうが高い", () => {
    const small = popularity(stats({ views: 10_000, likes: 400 })).P;
    const big = popularity(stats({ views: 1_000_000, likes: 40_000 })).P;
    expect(big).toBeGreaterThan(small);
  });

  it("無名の動画でも 0.3 を下回らない", () => {
    expect(popularity(stats({ views: 1, likes: 0 })).P).toBeGreaterThanOrEqual(0.3);
  });
});

describe("quality", () => {
  it("カメラ角度がその指標に合わなければ 0", () => {
    expect(quality(stats({ camera: "behind" }), "strideRatio")).toBe(0);
    expect(quality(stats({ camera: "behind" }), "hipShoulderSep")).toBeGreaterThan(0);
  });

  it("解像度と fps が低いと下がる", () => {
    expect(quality(stats({ resolution: 720, fps: 30 }), "strideRatio")).toBeLessThan(quality(stats(), "strideRatio"));
  });
});

describe("manual", () => {
  it("除外は 0、ピン留めは 1.5 倍、星 3 が基準", () => {
    expect(manual({ pinned: false, excluded: true, stars: 5 })).toBe(0);
    expect(manual({ pinned: false, excluded: false, stars: 3 })).toBeCloseTo(1);
    expect(manual({ pinned: true, excluded: false, stars: 3 })).toBeCloseTo(1.5);
  });
});

describe("consensus", () => {
  it("他のお手本から大きく外れた値の重みを下げる", () => {
    const k = consensus([0.5, 0.52, 0.51, 0.53, 0.5, 0.9], [1, 1, 1, 1, 1, 1]);
    expect(k[5]!).toBeLessThan(0.1);
    expect(Math.min(...k.slice(0, 5))).toBeGreaterThan(0.5);
  });

  it("比べる相手が 3 つ未満なら下げない", () => {
    expect(consensus([0.5, 0.9], [1, 1])).toEqual([1, 1]);
  });
});

describe("computeWeights", () => {
  const ok = { pinned: false, excluded: false, stars: 3 as const };
  const refs = [
    { id: "a", stats: stats(), manual: ok, metrics: { strideRatio: 0.5 } },
    { id: "b", stats: stats(), manual: ok, metrics: { strideRatio: 0.52 } },
    { id: "c", stats: stats(), manual: ok, metrics: { strideRatio: 0.54 } },
    // 人気はあるが癖の強いフォーム
    { id: "viral", stats: stats({ views: 5_000_000, likes: 200_000, subscribers: 2_000_000 }), manual: ok, metrics: { strideRatio: 0.8 } },
  ];

  it("人気の高い外れ値より、合意の取れたお手本の重みが大きくなる", () => {
    const r = computeWeights(refs);
    const w = (id: string) => r.parts[id]!.strideRatio!.w;
    expect(w("viral")).toBeLessThan(w("a"));
    expect(r.parts.viral!.strideRatio!.P).toBeGreaterThan(r.parts.a!.strideRatio!.P);
  });

  it("お手本ゾーンは外れ値に引っ張られない", () => {
    const zone = computeWeights(refs).zones.strideRatio!;
    expect(zone.p50).toBeGreaterThan(0.5);
    expect(zone.p50).toBeLessThan(0.56);
  });

  it("除外したお手本の重みは 0 になる", () => {
    const r = computeWeights(refs.map((x) => (x.id === "b" ? { ...x, manual: { ...ok, excluded: true } } : x)));
    expect(r.parts.b!.strideRatio!.w).toBe(0);
  });
});
