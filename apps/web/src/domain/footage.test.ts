import { describe, expect, it } from "vitest";
import { containFit, coverage, focusWindow, frameAt, toSource, toView, type TargetTrack } from "./footage";

const track = (n: number): TargetTrack => ({
  video: { name: "x", fps: 30, width: 1920, height: 1080, frameCount: n },
  hint: { x: 0, y: 0, t: 0 },
  segments: [{ trackId: 1, start: 0, end: n - 1 }],
  peopleTracked: 1,
  frames: Array.from({ length: n }, (_, i) => ({ i, t: i / 30, box: i % 10 === 9 ? null : { x1: 0, y1: 0, x2: 10, y2: 10, score: 1 }, kp: null, interpolated: i === 5 })),
});

describe("frameAt / coverage", () => {
  it("時刻に一番近いフレームを返し、範囲の外は端に丸める", () => {
    const t = track(60);
    expect(frameAt(t, 1.0)!.i).toBe(30);
    expect(frameAt(t, 1.02)!.i).toBe(31);
    expect(frameAt(t, -1)!.i).toBe(0);
    expect(frameAt(t, 99)!.i).toBe(59);
  });

  it("枠があるフレームと補間したフレームを数える", () => {
    expect(coverage(track(60))).toMatchObject({ found: 54, filled: 1, total: 60, ratio: 0.9 });
  });
});

describe("containFit / toSource / toView", () => {
  it("横長の動画を縦長の枠に収めると、上下に余白が付く", () => {
    const fit = containFit(1920, 1080, 960, 1000);
    expect(fit.scale).toBeCloseTo(0.5);
    expect(fit.h).toBeCloseTo(540);
    expect(fit.y).toBeCloseTo(230);
  });

  it("表示上の点と元の動画のピクセルを行き来できる", () => {
    const fit = containFit(1920, 1080, 1280, 720);
    const s = toSource(fit, 960, 286.7);
    expect(s.x).toBeCloseTo(1440);
    expect(s.y).toBeCloseTo(430, 0);
    const v = toView(fit, s.x, s.y);
    expect(v.x).toBeCloseTo(960);
  });
});

describe("focusWindow", () => {
  it("枠の高さの 2.6 倍が画面の高さになるよう拡大する", () => {
    const f = focusWindow({ x1: 1400, y1: 343, x2: 1478, y2: 523, score: 1 }, 1920, 1080);
    expect(f.scale).toBeCloseTo(1080 / (180 * 2.6));
    expect(f.cx).toBeCloseTo(1439);
  });

  it("端にいても動画の外が見えないよう中心を寄せる", () => {
    const f = focusWindow({ x1: 1880, y1: 900, x2: 1920, y2: 1080, score: 1 }, 1920, 1080);
    expect(f.cx + 1920 / f.scale / 2).toBeCloseTo(1920);
    expect(f.cy + 1080 / f.scale / 2).toBeCloseTo(1080);
  });

  it("小さすぎる枠でも拡大は 5 倍まで", () => {
    expect(focusWindow({ x1: 0, y1: 0, x2: 5, y2: 10, score: 1 }, 1920, 1080).scale).toBeCloseTo(5);
  });
});
