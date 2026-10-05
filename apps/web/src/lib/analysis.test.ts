import { describe, expect, it } from "vitest";
import { computeMetrics, detectEvents, invalidReason, judge, metricScore, METRIC_BY_KEY, phaseAt, toPhases, type Zone } from "./analysis";
import { smoothSequence } from "./pose";
import { synthesizeThrow } from "./synth";

const analyze = (params: Parameters<typeof synthesizeThrow>[0] = {}) => {
  const seq = smoothSequence(synthesizeThrow(params));
  const events = detectEvents(seq);
  return { seq, events, metrics: computeMetrics(seq, events) };
};

describe("detectEvents", () => {
  const { seq, events } = analyze();

  it("イベントがドロップ → セット → ステップ → 接地 → リリース → フォローの順に並ぶ", () => {
    expect(events.setStart).toBeGreaterThan(0);
    expect(events.strideStart).toBeGreaterThan(events.setStart);
    expect(events.plant).toBeGreaterThan(events.strideStart);
    expect(events.release).toBeGreaterThanOrEqual(events.plant);
    expect(events.followStart).toBeGreaterThan(events.release);
    expect(events.last).toBe(seq.frames.length - 1);
  });

  it("リリースを手首の速さのピーク（合成データのリリース時刻 1.16 秒）の ±2 フレームで検出する", () => {
    expect(Math.abs(events.release - Math.round(1.16 * seq.fps))).toBeLessThanOrEqual(2);
  });

  it("フェーズが隙間なくつながる", () => {
    const phases = toPhases(events);
    for (let i = 1; i < phases.length; i++) expect(phases[i]!.start).toBe(phases[i - 1]!.end);
    expect(phaseAt(phases, events.release)).toBe("release");
    expect(phaseAt(phases, 0)).toBe("drop");
  });
});

describe("computeMetrics", () => {
  it("ステップを広げるとステップ幅（身長比）が大きくなる", () => {
    const narrow = analyze({ stride: 0.85 }).metrics.strideRatio!;
    const wide = analyze({ stride: 1.1 }).metrics.strideRatio!;
    expect(wide).toBeGreaterThan(narrow);
    // 基準のステップ幅は 0.94m、身長 1.8m なので約 0.52
    expect(analyze().metrics.strideRatio!).toBeCloseTo(0.52, 1);
  });

  it("肘を下げるとリリース時の肘の高さが下がる", () => {
    const base = analyze().metrics.elbowHeight!;
    const dropped = analyze({ elbowDrop: 0.06 }).metrics.elbowHeight!;
    expect(base - dropped).toBeGreaterThan(3);
  });

  it("横からの 2D では測れない値は、外から渡されない限り undefined のまま", () => {
    expect(analyze().metrics.hipShoulderSep).toBeUndefined();
  });
});

describe("judge / metricScore", () => {
  const zone: Zone = { p10: 0.46, p25: 0.5, p50: 0.52, p75: 0.54, p90: 0.58 };

  it("四分位の内側は良好、10〜90% は注意、その外は要改善", () => {
    expect(judge(0.52, zone)).toBe("good");
    expect(judge(0.48, zone)).toBe("caution");
    expect(judge(0.44, zone)).toBe("flag");
    expect(judge(undefined, zone)).toBe("na");
  });

  it("四分位の内側は満点で、外れるほど下がり、40 点で止まる", () => {
    expect(metricScore(0.53, zone)).toBe(100);
    expect(metricScore(0.48, zone)!).toBeLessThan(100);
    expect(metricScore(0.1, zone)).toBe(40);
  });
});

describe("invalidReason", () => {
  it("測れない理由に必要なカメラ角度を含める", () => {
    expect(invalidReason(METRIC_BY_KEY.hipShoulderSep, "side")).toContain("後方から");
  });
});
