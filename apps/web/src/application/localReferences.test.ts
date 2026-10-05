import { describe, expect, it, vi } from "vitest";
import type { Footage } from "../domain/footage";
import type { LocalReference } from "../domain/reference";
import { resolutionClass } from "../domain/reference";
import type { ThrowAnalysis } from "../domain/throws";
import { synthesizeThrow } from "../infrastructure/demo/synth";
import { loadLocalReferences, meanConfidence, toReference } from "./localReferences";
import type { FootageLibrary } from "./ports";
import { weighReferences } from "./references";

const seq = synthesizeThrow();

const record = (id: string, videoId: string): LocalReference => ({
  id,
  videoId,
  youtubeId: "Qb7Throw_01",
  title: "架空の投球",
  channel: "架空の QB 研究所",
  channelId: "UCfake",
  license: "creativeCommon",
  kind: "model",
  trustedChannel: true,
  playerHeightCm: 188,
  stats: { views: 120_000, likes: null, comments: 3, subscribers: 52_000, durationSec: 95, publishedAt: "2025-01-01T00:00:00Z", fetchedAt: "2026-10-05T12:00:00Z" },
  manual: { pinned: false, excluded: false, stars: 3 },
  createdAt: "2026-10-05T12:00:00Z",
});

const footage = (id: string, throws: boolean): Footage => ({
  id,
  name: "架空の投球",
  source: "youtube",
  info: { name: "x", fps: 59.94, width: 1080, height: 1920, frameCount: 1800, duration: 30 },
  createdAt: "",
  youtube: { videoId: "Qb7Throw_01", start: 65, end: 95, title: "", channel: "", license: "creativeCommon", url: "" },
  mediaRetained: false,
  trackStatus: "done",
  label: "",
  errors: [],
  links: { self: "", frame: null, media: null, track: null, preview: null, focus: null, events: null, throws: throws ? `/api/videos/${id}/throws` : null },
});

const analysis: ThrowAnalysis = {
  video: { name: "x", fps: 60, width: 1080, height: 1920, frameCount: 1800 },
  heightM: 1.88,
  camera: "side",
  hand: "right",
  warnings: [],
  reps: [1, 2].map((index) => ({
    index,
    start: 100 * index,
    end: 100 * index + seq.frames.length - 1,
    transform: { mPerPx: 0.003, originX: 0, groundY: 1000, direction: 1, ankleM: 0.07 },
    events: { setStart: 35, strideStart: 50, plant: 65, release: 69, followStart: 74, last: seq.frames.length - 1 },
    phases: [],
    metrics: { strideRatio: 0.5 + index / 100, frontKnee: 160 },
    sequence: seq,
  })),
};

describe("手元のお手本をデモと同じ形に写す", () => {
  it("統計・解析品質の材料・投球を写す。非公開の高評価数は 0 とみなす", () => {
    const r = toReference(record("r1", "v1"), footage("v1", true), analysis);
    expect(r).toMatchObject({ id: "r1", publishedAt: "2025-01-01", duration: "1:35", segment: { start: "1:05", end: "1:35" }, creativeCommons: true, kind: "model" });
    expect(r.stats).toMatchObject({ views: 120_000, likes: 0, subscribers: 52_000, trustedChannel: true, camera: "side", resolution: 1080, fps: 59.94 });
    expect(r.stats.confidence).toBeCloseTo(meanConfidence(analysis));
    expect(r.reps.map((x) => x.id)).toEqual(["r1#1", "r1#2"]);
    expect(r.reps[0]!.rotation).toEqual([]);
  });

  it("写したお手本は、デモと同じ重み付けで分布になる", () => {
    const refs = [toReference(record("r1", "v1"), footage("v1", true), analysis)];
    const w = weighReferences(refs, { r1: { pinned: false, excluded: false, stars: 3 } });
    expect(w.zones.strideRatio).toBeDefined();
    expect(w.overall.r1).toBeGreaterThan(0);
  });

  it("解像度は短い辺で区分する（縦長の Shorts でも高さで決めない）", () => {
    expect([resolutionClass(1080, 1920), resolutionClass(1920, 1080), resolutionClass(1280, 720), resolutionClass(640, 360), resolutionClass(3840, 2160)]).toEqual([1080, 1080, 720, 480, 2160]);
  });

  it("元の映像か投球の解析結果が読めないお手本は、壊れているものとして分ける", async () => {
    const lib = {
      references: vi.fn(async () => [record("r1", "v1"), record("r2", "v2"), record("r3", "v3")]),
      get: vi.fn(async (id: string) => {
        if (id === "v3") throw new Error("ありません");
        return footage(id, id === "v1");
      }),
      throws: vi.fn(async () => analysis),
    } as unknown as FootageLibrary;
    const l = await loadLocalReferences(lib);
    expect(l.refs.map((r) => r.id)).toEqual(["r1"]);
    expect(l.broken.map((r) => r.id)).toEqual(["r2", "r3"]);
  });
});
