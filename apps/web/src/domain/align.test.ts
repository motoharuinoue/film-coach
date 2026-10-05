import { describe, expect, it } from "vitest";
import { alignedFrame, alignOffset } from "./align";
import { detectEvents } from "./phases";
import { kp } from "./pose";
import { synthesizeThrow } from "../infrastructure/demo/synth";

const rep = (p: Parameters<typeof synthesizeThrow>[0]) => {
  const seq = synthesizeThrow(p);
  return { seq, events: detectEvents(seq) };
};

describe("align", () => {
  const self = rep({ tempo: 1 });
  const slow = rep({ tempo: 1.15, stride: 1.1 });

  it("リリースのフレーム同士が対応する", () => {
    expect(alignedFrame(self, slow, self.events.release)).toBe(slow.events.release);
  });

  it("範囲外のフレームは端に丸める", () => {
    expect(alignedFrame(self, slow, -100)).toBe(0);
    expect(alignedFrame(self, slow, 10_000)).toBe(slow.seq.frames.length - 1);
  });

  it("接地時の後ろ足が重なるように平行移動する", () => {
    const o = alignOffset(self, slow);
    const a = kp(self.seq.frames[self.events.plant]!, "rAnkle");
    const b = kp(slow.seq.frames[slow.events.plant]!, "rAnkle");
    expect(b.x + o.x).toBeCloseTo(a.x);
    expect(b.y + o.y).toBeCloseTo(a.y);
  });
});
