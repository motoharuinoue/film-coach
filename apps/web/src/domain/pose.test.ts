import { describe, expect, it } from "vitest";
import { jointAngle, smoothSequence, speedSeries, type PoseSequence } from "./pose";

const still = (x: number, y: number) => Array.from({ length: 17 }, () => ({ x, y, c: 0.9 }));

describe("jointAngle", () => {
  it("直角を 90 度と計算する", () => {
    expect(jointAngle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90);
  });

  it("一直線なら 180 度になる", () => {
    expect(jointAngle({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 2, y: 0 })).toBeCloseTo(180);
  });
});

describe("speedSeries", () => {
  it("等速で動く関節の速さを中心差分で求める", () => {
    const fps = 60;
    // 1 フレームに 0.05m ずつ x 方向へ動く = 3 m/s
    const seq: PoseSequence = {
      fps,
      heightM: 1.8,
      frames: Array.from({ length: 10 }, (_, i) => ({ t: i / fps, kp: still(i * 0.05, 1) })),
    };
    const v = speedSeries(seq, "rWrist");
    expect(v[5]).toBeCloseTo(3);
    // 端は片側差分になる
    expect(v[0]).toBeCloseTo(3);
  });
});

describe("smoothSequence", () => {
  it("止まっている骨格は平滑化しても位置が変わらない", () => {
    const seq: PoseSequence = { fps: 60, heightM: 1.8, frames: Array.from({ length: 8 }, (_, i) => ({ t: i / 60, kp: still(0.3, 1.2) })) };
    const s = smoothSequence(seq);
    for (const f of s.frames) {
      expect(f.kp[10]!.x).toBeCloseTo(0.3);
      expect(f.kp[10]!.y).toBeCloseTo(1.2);
    }
  });

  it("1 フレームだけの外れ値を弱める", () => {
    const frames = Array.from({ length: 9 }, (_, i) => ({ t: i / 60, kp: still(0, i === 4 ? 0.5 : 0) }));
    const s = smoothSequence({ fps: 60, heightM: 1.8, frames });
    expect(s.frames[4]!.kp[0]!.y).toBeLessThan(0.15);
  });
});
