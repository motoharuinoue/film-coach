import { describe, expect, it, vi } from "vitest";
import type { Footage } from "../domain/footage";
import type { Practice } from "../domain/practice";
import type { ThrowAnalysis } from "../domain/throws";
import { analyzeUnanalyzed, loadPractice } from "./practice";
import type { FootageLibrary } from "./ports";

const footage = (id: string, trackStatus: Footage["trackStatus"], throws: boolean): Footage => ({
  id,
  name: `${id}.mov`,
  source: "upload",
  info: { name: `${id}.mov`, fps: 30, width: 1920, height: 1080, frameCount: 120, duration: 4 },
  createdAt: "2026-10-05T00:00:00Z",
  youtube: null,
  mediaRetained: true,
  trackStatus,
  label: "",
  errors: [],
  links: { self: `/api/videos/${id}`, frame: null, media: null, track: null, preview: null, focus: null, events: null, throws: throws ? `/api/videos/${id}/throws` : null },
});

const analysis = (n: number): ThrowAnalysis => ({
  video: { name: "x", fps: 30, width: 1920, height: 1080, frameCount: 120 },
  heightM: 1.8,
  camera: "side",
  hand: "right",
  warnings: [],
  reps: Array.from({ length: n }, (_, i) => ({
    index: i + 1,
    start: 0,
    end: 50,
    transform: { mPerPx: 0.003, originX: 0, groundY: 1000, direction: 1 as const, ankleM: 0.07 },
    events: { setStart: 0, strideStart: 10, plant: 20, release: 25, followStart: 30, last: 50 },
    phases: [],
    metrics: {},
    sequence: { fps: 30, heightM: 1.8, frames: [] },
  })),
});

const practice: Practice = { id: "p1", name: "ドリル", date: "2026-10-05", kind: "drill", camera: "side", memo: "", videoIds: ["a", "b", "c"], createdAt: "" };

function fakeLib() {
  const videos: Record<string, Footage> = { a: footage("a", "done", true), b: footage("b", "done", false), c: footage("c", "none", false) };
  return {
    practice: vi.fn(async () => practice),
    get: vi.fn(async (id: string) => videos[id]!),
    throws: vi.fn(async () => analysis(2)),
    analyzeThrows: vi.fn(async () => analysis(1)),
  } as unknown as FootageLibrary & { analyzeThrows: ReturnType<typeof vi.fn> };
}

describe("練習のユースケース", () => {
  it("まとめた順に映像と投球を読み、まだ解析していない映像と、まだ追跡していない映像を分ける", async () => {
    const view = await loadPractice(fakeLib(), "p1");
    expect(view.entries.map((e) => e.footage.id)).toEqual(["a", "b", "c"]);
    expect(view.throws).toHaveLength(2);
    expect(view.unanalyzed.map((f) => f.id)).toEqual(["b"]);
    expect(view.untracked.map((f) => f.id)).toEqual(["c"]);
  });

  it("まだ解析していない映像だけを、練習のカメラ角度と同じ身長でまとめて解析する", async () => {
    const lib = fakeLib();
    const view = await analyzeUnanalyzed(lib, await loadPractice(lib, "p1"), 178);
    expect(lib.analyzeThrows).toHaveBeenCalledTimes(1);
    expect(lib.analyzeThrows).toHaveBeenCalledWith("b", { heightCm: 178, camera: "side" });
    expect(view.throws.map((t) => t.footageId)).toEqual(["a", "a", "b"]);
    expect(view.unanalyzed).toEqual([]);
  });
});
