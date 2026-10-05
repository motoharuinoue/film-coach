import { describe, expect, it } from "vitest";
import { synthesizeThrow } from "../infrastructure/demo/synth";
import { detectEvents, phaseAt, toPhases } from "./phases";
import { smoothSequence } from "./pose";

describe("detectEvents", () => {
  const seq = smoothSequence(synthesizeThrow());
  const events = detectEvents(seq);

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
