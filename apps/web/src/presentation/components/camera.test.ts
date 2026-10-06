import { describe, expect, it } from "vitest";
import type { PoseFrame } from "../../domain/pose";
import { fitCamera } from "./camera";

/** x0〜x1 に関節を横に並べ、いちばん高い関節を top にしたフレーム */
const frame = (x0: number, x1: number, top = 1.8): PoseFrame => ({
  t: 0,
  kp: Array.from({ length: 17 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / 16, y: (top * i) / 16, c: 1 })),
});

describe("fitCamera", () => {
  it("縦横比は 16:9 で、関節の左右の端の真ん中に合わせる", () => {
    const cam = fitCamera([frame(0.2, 0.8)]);
    expect((cam.y1 - cam.y0) / (cam.x1 - cam.x0)).toBeCloseTo(9 / 16);
    expect((cam.x0 + cam.x1) / 2).toBeCloseTo(0.5);
  });

  it("どの原点のデータでも、関節がすべて範囲に入る", () => {
    for (const [a, b] of [
      [-1.8, -1.2],
      [0.6, 1.5],
      [-0.3, 2.4],
    ]) {
      const cam = fitCamera([frame(a!, b!)]);
      expect(cam.x0).toBeLessThan(a!);
      expect(cam.x1).toBeGreaterThan(b!);
      expect(cam.y1).toBeGreaterThan(1.8);
    }
  });

  it("全フレームを入れ、minWidth より狭くしない", () => {
    const cam = fitCamera([frame(-1.7, -1.2), frame(0.1, 0.6)], 6);
    expect(cam.x0).toBeLessThan(-1.7);
    expect(cam.x1).toBeGreaterThan(0.6);
    expect(cam.x1 - cam.x0).toBe(6);
  });
});
