// TypeScript と Python（services/analyzer）が同じ規則で計算していることを確かめる共通データ。
// UPDATE_FIXTURES=1 のときは、この実装の結果で packages/schema/fixtures/parity.v1.json を作り直す。

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { synthesizeThrow, type ThrowParams } from "../infrastructure/demo/synth";
import { computeMetrics, type MetricValues } from "./metrics";
import { detectEvents, type Events } from "./phases";
import { smoothSequence, type PoseSequence } from "./pose";

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../packages/schema/fixtures/parity.v1.json");

type Case = { name: string; params: Partial<ThrowParams>; sequence: SequenceJson; expected: { events: Events; metrics: MetricValues } };
type SequenceJson = { schemaVersion: 1; keypointLayout: "coco17"; space: "world-2d"; fps: number; heightM: number; frames: { t: number; kp: [number, number, number][] }[] };

const CASES: { name: string; params: Partial<ThrowParams> }[] = [
  { name: "基準", params: {} },
  { name: "ステップが狭く肘が下がる", params: { stride: 0.85, elbowDrop: 0.06, seed: 604 } },
  { name: "ステップが広く速い", params: { stride: 1.1, tempo: 0.92, seed: 7 } },
  { name: "ゆっくりで上下動が大きい", params: { tempo: 1.12, lean: 0.04, bob: 0.015, seed: 9 } },
];

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

function toJson(seq: PoseSequence): SequenceJson {
  return {
    schemaVersion: 1,
    keypointLayout: "coco17",
    space: "world-2d",
    fps: seq.fps,
    heightM: seq.heightM,
    frames: seq.frames.map((f) => ({ t: r6(f.t), kp: f.kp.map((p) => [r6(p.x), r6(p.y), r6(p.c)] as [number, number, number]) })),
  };
}

function fromJson(j: SequenceJson): PoseSequence {
  return { fps: j.fps, heightM: j.heightM, frames: j.frames.map((f) => ({ t: f.t, kp: f.kp.map(([x, y, c]) => ({ x, y, c })) })) };
}

/** 解析サービスと同じ手順：平滑化 → フェーズ分割 → 指標 */
function run(seq: PoseSequence) {
  const smoothed = smoothSequence(seq);
  const events = detectEvents(smoothed);
  return { events, metrics: computeMetrics(smoothed, events) };
}

function build(): Case[] {
  return CASES.map(({ name, params }) => {
    // 丸めた後の値から期待値を出す（Python は丸めた値を読むので）
    const sequence = toJson(synthesizeThrow(params));
    return { name, params, sequence, expected: run(fromJson(sequence)) };
  });
}

describe("両言語の共通データ（parity）", () => {
  if (process.env.UPDATE_FIXTURES) {
    it("共通データを作り直す", () => {
      writeFileSync(FIXTURE, `${JSON.stringify({ schemaVersion: 1, generatedBy: "apps/web/src/domain/parity.test.ts", cases: build() })}\n`);
    });
  }

  it("共通データがある", () => {
    expect(existsSync(FIXTURE)).toBe(true);
  });

  const fixture = existsSync(FIXTURE) ? (JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: Case[] }) : { cases: [] };
  for (const c of fixture.cases) {
    it(`${c.name}：フェーズと指標が期待値と一致する`, () => {
      const got = run(fromJson(c.sequence));
      expect(got.events).toEqual(c.expected.events);
      for (const [k, v] of Object.entries(c.expected.metrics)) expect(got.metrics[k as keyof MetricValues]).toBeCloseTo(v as number, 9);
    });
  }
});
