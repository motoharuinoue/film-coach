import { describe, expect, it } from "vitest";
import { synthesizeThrow } from "../infrastructure/demo/synth";
import { computeMetrics, formatMetric, invalidReason, METRIC_BY_KEY, MIN_SET_S, onlyValid } from "./metrics";
import { detectEvents, strideFound, strideSeen } from "./phases";
import { smoothSequence, type PoseSequence } from "./pose";

const analyze = (params: Parameters<typeof synthesizeThrow>[0] = {}) => {
  const seq = smoothSequence(synthesizeThrow(params));
  const events = detectEvents(seq);
  return computeMetrics(seq, events);
};

describe("computeMetrics", () => {
  it("ステップを広げるとステップ幅（身長比）が大きくなる", () => {
    expect(analyze({ stride: 1.1 }).strideRatio!).toBeGreaterThan(analyze({ stride: 0.85 }).strideRatio!);
    // 基準のステップ幅は 0.94m、身長 1.8m なので約 0.52
    expect(analyze().strideRatio!).toBeCloseTo(0.52, 1);
  });

  it("肘を下げるとリリース時の肘の高さが下がる", () => {
    expect(analyze().elbowHeight! - analyze({ elbowDrop: 0.06 }).elbowHeight!).toBeGreaterThan(3);
  });

  it("横からの 2D では測れない値は、外から渡されない限り undefined のまま", () => {
    expect(analyze().hipShoulderSep).toBeUndefined();
  });
});

/** start 以降の骨格（時刻は 0 から） */
const from = (seq: PoseSequence, start: number): PoseSequence => ({ ...seq, frames: seq.frames.slice(start).map((f, i) => ({ ...f, t: i / seq.fps })) });

describe("映っていない区間・見つからないイベントからは測らない", () => {
  const seq = smoothSequence(synthesizeThrow());
  const e = detectEvents(seq);

  it("前足が動かずステップが見つからなければ、ステップと接地をリリースにそろえ、足の指標と時間を出さない", () => {
    const frozen = { ...seq, frames: seq.frames.map((f) => ({ ...f, kp: f.kp.map((p, i) => (i === 15 ? { ...seq.frames[0]!.kp[15]!, c: p.c } : p)) })) };
    const fe = detectEvents(frozen);
    expect([fe.strideStart, fe.plant]).toEqual([fe.release, fe.release]);
    expect(strideFound(fe)).toBe(false);
    const m = computeMetrics(frozen, fe);
    expect([m.releaseTime, m.strideRatio, m.frontKnee, m.headStability]).toEqual([undefined, undefined, undefined, undefined]);
    expect(m.elbowAngle).toBeDefined();
  });

  it("ステップの途中から映っていれば、始動からリリースだけ出さない", () => {
    const cut = from(seq, e.strideStart + 2);
    const ce = detectEvents(cut);
    expect(ce.strideStart).toBe(0);
    expect([strideFound(ce), strideSeen(ce)]).toEqual([true, false]);
    const m = computeMetrics(cut, ce);
    expect(m.releaseTime).toBeUndefined();
    expect(m.strideRatio).toBeCloseTo(computeMetrics(seq, e).strideRatio!, 9);
  });

  it(`頭の上下動は、ステップの前が ${MIN_SET_S} 秒より短ければ出さない`, () => {
    const need = Math.round(MIN_SET_S * seq.fps);
    const short = from(seq, e.strideStart - (need - 2));
    const long = from(seq, e.strideStart - (need + 2));
    expect(computeMetrics(short, detectEvents(short)).headStability).toBeUndefined();
    expect(computeMetrics(long, detectEvents(long)).headStability).toBeDefined();
  });
});

describe("onlyValid / invalidReason", () => {
  it("カメラ角度で測れない指標を捨てる", () => {
    const v = onlyValid({ strideRatio: 0.5, hipShoulderSep: 40 }, "side");
    expect(v).toEqual({ strideRatio: 0.5 });
  });

  it("測れない理由に必要なカメラ角度を含める", () => {
    expect(invalidReason(METRIC_BY_KEY.hipShoulderSep, "side")).toContain("後方から");
  });
});

describe("formatMetric", () => {
  it("桁数と単位をそろえ、値がなければダッシュ", () => {
    expect(formatMetric("releaseTime", 0.3333)).toBe("0.33 s");
    expect(formatMetric("strideRatio", 0.5)).toBe("0.50");
    expect(formatMetric("frontKnee", undefined)).toBe("—");
  });
});
