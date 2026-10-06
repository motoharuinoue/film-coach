import { describe, expect, it } from "vitest";
import { alignedFrame, anchors, applyFit, fitTo, type Alignable } from "./align";
import { detectEvents } from "./phases";
import { kp, smoothSequence, type PoseSequence } from "./pose";
import { synthesizeThrow } from "../infrastructure/demo/synth";

const rep = (p: Parameters<typeof synthesizeThrow>[0], fps = 60): Alignable => {
  const seq = smoothSequence(synthesizeThrow(p, fps));
  return { seq, events: detectEvents(seq) };
};

/** 体の大きさだけを k 倍にした列 */
const scaled = (seq: PoseSequence, k: number): PoseSequence => ({
  ...seq,
  heightM: seq.heightM * k,
  frames: seq.frames.map((f) => ({ ...f, kp: f.kp.map((p) => ({ x: p.x * k, y: p.y * k, c: p.c })) })),
});

describe("時間の合わせ方", () => {
  const self = rep({ tempo: 1 });
  const slow = rep({ tempo: 1.15, stride: 1.1 });

  it("フェーズの区切り（ステップ開始・接地・リリース・フォロー開始）どうしが対応する", () => {
    for (const k of ["strideStart", "plant", "release", "followStart"] as const) {
      expect(alignedFrame(self, slow, self.events[k])).toBe(slow.events[k]);
    }
  });

  it("区切りの間は線形に伸び縮みし、順序が入れ替わらない", () => {
    const mapped = self.seq.frames.map((_, i) => alignedFrame(self, slow, i));
    expect(mapped.every((f, i) => i === 0 || f >= mapped[i - 1]!)).toBe(true);
    const mid = Math.round((self.events.plant + self.events.release) / 2);
    expect(alignedFrame(self, slow, mid)).toBeGreaterThan(slow.events.plant);
    expect(alignedFrame(self, slow, mid)).toBeLessThan(slow.events.release);
  });

  it("fps が違っても秒で合わせる（スロー再生のお手本と 30fps の自分）", () => {
    const fast = rep({ tempo: 1 }, 120);
    expect(Math.abs(alignedFrame(self, fast, self.events.release) - fast.events.release)).toBeLessThanOrEqual(1);
    expect(Math.abs(alignedFrame(self, fast, self.events.plant) - fast.events.plant)).toBeLessThanOrEqual(1);
  });

  it("範囲外のフレームは端に丸める", () => {
    expect(alignedFrame(self, slow, -100)).toBe(0);
    expect(alignedFrame(self, slow, 10_000)).toBe(slow.seq.frames.length - 1);
  });

  it("どちらかで見つかっていない区切りは使わない。リリースは必ず使う", () => {
    const noStride: Alignable = { ...slow, events: { ...slow.events, strideStart: slow.events.release, plant: slow.events.release } };
    const keys = anchors(self, noStride).map(([a]) => Math.round(a * self.seq.fps));
    expect(keys).toContain(self.events.release);
    expect(keys).not.toContain(self.events.plant);
    expect(alignedFrame(self, noStride, self.events.release)).toBe(slow.events.release);
  });
});

describe("体格と位置の合わせ方", () => {
  const self = rep({});

  it("比べる相手を自分の身長に合わせて縮め、同じ動きなら骨格がぴったり重なる", () => {
    const big: Alignable = { seq: scaled(self.seq, 1.1), events: self.events };
    const fit = fitTo(self, big);
    expect(fit.scale).toBeCloseTo(1 / 1.1);
    for (const i of [0, self.events.plant, self.events.release]) {
      const placed = applyFit(big.seq.frames[i]!, fit);
      placed.kp.forEach((p, j) => {
        expect(p.x).toBeCloseTo(self.seq.frames[i]!.kp[j]!.x, 9);
        expect(p.y).toBeCloseTo(self.seq.frames[i]!.kp[j]!.y, 9);
      });
    }
  });

  it("接地時の後ろ足が重なるように動かす", () => {
    const other = rep({ stride: 1.1, tempo: 1.1 });
    const fit = fitTo(self, other);
    const a = kp(self.seq.frames[self.events.plant]!, "rAnkle");
    const b = kp(applyFit(other.seq.frames[other.events.plant]!, fit), "rAnkle");
    expect(b.x).toBeCloseTo(a.x);
    expect(b.y).toBeCloseTo(a.y);
  });

  it("ステップが見つからなければ、リリース時の骨盤の前後位置で合わせ、高さは地面のまま", () => {
    const other = rep({ stride: 1.1 });
    const noStride: Alignable = { ...other, events: { ...other.events, strideStart: other.events.release, plant: other.events.release } };
    const fit = fitTo(self, noStride);
    const pelvis = (f: Alignable["seq"]["frames"][number]) => (kp(f, "lHip").x + kp(f, "rHip").x) / 2;
    expect(pelvis(applyFit(other.seq.frames[other.events.release]!, fit))).toBeCloseTo(pelvis(self.seq.frames[self.events.release]!));
    expect(fit.offset.y).toBe(0);
  });
});
