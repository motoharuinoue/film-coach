import { describe, expect, it } from "vitest";
import { synthesizeThrow } from "../infrastructure/demo/synth";
import { computeMetrics, formatMetric, invalidReason, METRIC_BY_KEY, onlyValid } from "./metrics";
import { detectEvents } from "./phases";
import { smoothSequence } from "./pose";

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
