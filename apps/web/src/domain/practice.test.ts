import { describe, expect, it } from "vitest";
import { synthesizeThrow } from "../infrastructure/demo/synth";
import { detectEvents } from "./phases";
import { smoothSequence } from "./pose";
import { collectThrows, metricSpreads, releasePoint, releaseSpread } from "./practice";
import type { ThrowAnalysis, ThrowRep } from "./throws";

const seq = smoothSequence(synthesizeThrow());
const events = detectEvents(seq);

const rep = (index: number, metrics: ThrowRep["metrics"]): ThrowRep => ({
  index,
  start: index * 200,
  end: index * 200 + seq.frames.length - 1,
  transform: { mPerPx: 0.003, originX: 0, groundY: 1000, direction: 1, ankleM: 0.07 },
  events,
  phases: [],
  metrics,
  sequence: seq,
});

const analysis = (reps: ThrowRep[]): ThrowAnalysis => ({
  video: { name: "x", fps: 30, width: 1920, height: 1080, frameCount: 900 },
  heightM: 1.8,
  camera: "side",
  hand: "right",
  reps,
  warnings: [],
  slowmo: 1,
});

describe("練習の投球", () => {
  it("映像の並び順・映像の中の順に、通し番号を付けて並べる。解析していない映像は飛ばす", () => {
    const throws = collectThrows([
      { id: "b", name: "B.mov", analysis: analysis([rep(1, {}), rep(2, {})]) },
      { id: "x", name: "X.mov" },
      { id: "a", name: "A.mov", analysis: analysis([rep(1, {})]) },
    ]);
    expect(throws.map((t) => [t.order, t.footageId, t.rep.index])).toEqual([
      [1, "b", 1],
      [2, "b", 2],
      [3, "a", 1],
    ]);
  });

  it("指標ごとに平均・幅・標準偏差を出し、どの投球でも測れなかった指標は入れない", () => {
    const throws = collectThrows([{ id: "a", name: "A", analysis: analysis([rep(1, { strideRatio: 0.4 }), rep(2, { strideRatio: 0.5 }), rep(3, {})]) }]);
    const spreads = metricSpreads(throws);
    expect(spreads.map((s) => s.key)).toEqual(["strideRatio"]);
    const s = spreads[0]!;
    expect(s.values).toEqual([0.4, 0.5, undefined]);
    expect(s).toMatchObject({ n: 2, min: 0.4, max: 0.5 });
    expect(s.mean).toBeCloseTo(0.45);
    expect(s.sd).toBeCloseTo(0.05);
  });

  it("リリース点は、接地時の後ろ足からの前後位置とリリースの高さ（cm）", () => {
    const p = releasePoint(seq, events);
    const wrist = seq.frames[events.release]!.kp[10]!;
    expect(p.y).toBeCloseTo(wrist.y * 100);
    expect(p.x).toBeGreaterThan(0); // リリースは後ろ足より前
  });

  it("リリース点のばらつきは 2 球以上で出し、4 cm 以下を満点にする", () => {
    expect(releaseSpread([{ x: 0, y: 0 }])).toBeUndefined();
    expect(releaseSpread([{ x: 0, y: 0 }, { x: 2, y: 0 }])).toEqual({ spread: 1, score: 100 });
    expect(releaseSpread([{ x: 0, y: 0 }, { x: 40, y: 0 }])!.score).toBe(40);
  });
});
