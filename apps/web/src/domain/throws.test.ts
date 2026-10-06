import { describe, expect, it } from "vitest";
import type { Phase } from "./phases";
import { isValidHeightCm, releaseFrame, spread, throwAt, type ThrowAnalysis, type ThrowRep } from "./throws";

const phases: Phase[] = [
  { key: "drop", start: 0, end: 10 },
  { key: "set", start: 10, end: 20 },
  { key: "stride", start: 20, end: 30 },
  { key: "release", start: 30, end: 35 },
  { key: "follow", start: 35, end: 49 },
];

const rep = (index: number, start: number, metrics: ThrowRep["metrics"]): ThrowRep => ({
  index,
  start,
  end: start + 49,
  transform: { mPerPx: 0.003, originX: 0, groundY: 1000, direction: 1, ankleM: 0.07 },
  events: { setStart: 10, strideStart: 20, plant: 30, release: 33, followStart: 35, last: 49 },
  phases,
  metrics,
  approach: { kind: "unknown", dropM: null },
  sequence: { fps: 30, heightM: 1.8, frames: [] },
});

const analysis = (reps: ThrowRep[]): ThrowAnalysis => ({
  video: { name: "x.mov", fps: 30, width: 1920, height: 1080, frameCount: 300 },
  heightM: 1.8,
  camera: "side",
  hand: "right",
  reps,
  warnings: [],
  slowmo: 1,
  approachMode: "auto",
});

describe("投球", () => {
  it("リリースを映像のフレーム番号で返す", () => {
    expect(releaseFrame(rep(1, 100, {}))).toBe(133);
  });

  it("映像のフレームが入っている投球と、そのときのフェーズを返す", () => {
    const a = analysis([rep(1, 100, {}), rep(2, 200, {})]);
    expect(throwAt(a, 125)).toMatchObject({ rep: { index: 1 }, phase: "stride" });
    expect(throwAt(a, 233)).toMatchObject({ rep: { index: 2 }, phase: "release" });
    expect(throwAt(a, 160)).toBeUndefined(); // 投球と投球の間
  });

  it("2 本以上あるときだけ、指標の平均と幅を出す", () => {
    expect(spread(analysis([rep(1, 0, { strideRatio: 0.4 })]), "strideRatio")).toBeUndefined();
    const s = spread(analysis([rep(1, 0, { strideRatio: 0.4 }), rep(2, 100, { strideRatio: 0.5 }), rep(3, 200, {})]), "strideRatio");
    expect(s).toEqual({ mean: 0.45, min: 0.4, max: 0.5, n: 2 });
  });

  it("身長は解析サービスと同じ範囲（120〜230 cm）だけ受け付ける", () => {
    expect([119, 120, 175.5, 230, 231, Number.NaN].map(isValidHeightCm)).toEqual([false, true, true, true, false, false]);
  });
});
