import { describe, expect, it } from "vitest";
import { synthesizeThrow } from "../infrastructure/demo/synth";
import { computeMetrics, formatMetric, fpsNeeded, invalidReason, isImprecise, METRIC_BY_KEY, metricUncertainty, MIN_SET_S, onlyValid, preciseOnly } from "./metrics";
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

describe("接地・リリースの瞬間の時刻のずれでの変わり幅", () => {
  const at = (fps: number) => {
    const seq = smoothSequence(synthesizeThrow({}, fps));
    const e = detectEvents(seq);
    const m = computeMetrics(seq, e);
    return { seq, e, m, u: metricUncertainty(seq, e, m) };
  };

  it("前後のコマの値の差の半分。瞬間で測る指標だけに付ける", () => {
    const { seq, e, m, u } = at(60);
    const wrist = (i: number) => seq.frames[i]!.kp[10]!.y / seq.heightM;
    expect(u.releaseHeight).toBeCloseTo(Math.abs(wrist(e.release + 1) - wrist(e.release - 1)) / 2, 12);
    expect(Object.keys(u).sort()).toEqual(["elbowAngle", "elbowHeight", "frontKnee", "releaseHeight", "strideRatio", "trunkTilt"]);
    expect(m.releaseTime).toBeDefined();
    expect(u.releaseTime).toBeUndefined();
  });

  it("fps を上げると小さくなる（腕が速く動くリリースの瞬間ほど、低い fps では大きく変わる）", () => {
    const low = at(30).u;
    const high = at(240).u;
    // 合成データにはコマごとの揺らぎがあるので、反比例まではいかない
    expect(high.releaseHeight!).toBeLessThan(low.releaseHeight!);
    expect(high.elbowHeight!).toBeLessThan(low.elbowHeight!);
  });

  it("上限を超えたら判定しない値とし、お手本ゾーンに入れる値からは除く", () => {
    expect(isImprecise("releaseHeight", 0.05)).toBe(true);
    expect(isImprecise("releaseHeight", 0.02)).toBe(false);
    expect(isImprecise("releaseTime", 99)).toBe(false); // 瞬間で測る指標ではない
    expect(isImprecise("elbowAngle", undefined)).toBe(false); // 変わり幅を入れる前の結果
    expect(preciseOnly({ releaseHeight: 0.9, trunkTilt: 4, releaseTime: 0.5 }, { releaseHeight: 0.05, trunkTilt: 1 })).toEqual({ trunkTilt: 4, releaseTime: 0.5 });
  });

  it("上限に収めるのに要る fps の目安（変わり幅は fps にほぼ反比例する）", () => {
    expect(fpsNeeded("elbowAngle", 30, 30)).toBe(120); // 30 × 30 / 10 = 90
    expect(fpsNeeded("elbowAngle", 46, 30)).toBe(240); // 138
    expect(fpsNeeded("elbowAngle", 20, 240)).toBeUndefined(); // 480：240 でも足りない
  });
});
