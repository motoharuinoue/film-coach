import { describe, expect, it, vi } from "vitest";
import { detectEvents, toPhases } from "../domain/phases";
import type { Footage } from "../domain/footage";
import type { ZoneSet } from "../domain/judgement";
import { smoothSequence } from "../domain/pose";
import type { Practice } from "../domain/practice";
import type { ThrowAnalysis, ThrowHand, ThrowRep } from "../domain/throws";
import { synthesizeThrow } from "../infrastructure/demo/synth";
import { focusOf, loadLocalSessions, localPlayer, toSession } from "./localData";
import type { FootageLibrary } from "./ports";
import { viewOf } from "./practice";

const seq = smoothSequence(synthesizeThrow());
const events = detectEvents(seq);

const footage = (id: string): Footage => ({
  id,
  name: `${id}.mov`,
  source: "upload",
  info: { name: `${id}.mov`, fps: 30, width: 1920, height: 1080, frameCount: 120, duration: 4 },
  createdAt: "",
  youtube: null,
  mediaRetained: true,
  trackStatus: "done",
  label: "",
  errors: [],
  links: { self: `/api/videos/${id}`, frame: null, media: null, track: null, preview: null, focus: null, events: null, throws: `/api/videos/${id}/throws` },
});

const rep = (index: number, strideRatio: number, approach?: ThrowRep["approach"]): ThrowRep => ({
  index,
  start: 100 * index,
  end: 100 * index + seq.frames.length - 1,
  transform: { mPerPx: 0.003, originX: 0, groundY: 1000, direction: 1, ankleM: 0.07 },
  events,
  phases: toPhases(events),
  // 前膝角度と肘の高さは、下のお手本ゾーンの中（スコアを出せる 3 指標にする）
  metrics: { strideRatio, frontKnee: 158, elbowHeight: 10 },
  approach,
  sequence: seq,
});

const analysis = (reps: ThrowRep[], hand: ThrowHand = "right"): ThrowAnalysis => ({
  video: { name: "x.mov", fps: 30, width: 1920, height: 1080, frameCount: 900 },
  heightM: 1.8,
  camera: "side",
  hand,
  reps,
  warnings: [],
  slowmo: 1,
  approachMode: "auto",
});

const practice = (id: string, date: string, videoIds: string[], createdAt = ""): Practice => ({ id, name: id, date, kind: "drill", camera: "side", memo: "", videoIds, createdAt });

describe("練習をセッションに写す", () => {
  it("まとめた映像の投球を順にレップにし、投げ始めと元の映像の位置を添える", () => {
    const view = viewOf(practice("p1", "2026-10-05", ["a", "b"]), [
      { footage: footage("a"), analysis: analysis([rep(1, 0.45, { kind: "drop", dropM: 1.4 }), rep(2, 0.44)]) },
      { footage: footage("b"), analysis: analysis([rep(1, 0.42, { kind: "standing", dropM: 0.1 })]) },
    ]);
    const s = toSession(view)!;
    expect(s).toMatchObject({ id: "p1", date: "2026-10-05", kind: "drill", camera: "side", title: "p1", source: "local" });
    expect(s.reps.map((r) => [r.id, r.index, r.approach])).toEqual([
      ["a#1", 0, "drop"],
      ["a#2", 1, "unknown"],
      ["b#1", 2, "standing"],
    ]);
    expect(s.reps[2]!.clip).toEqual({ videoId: "b", frame0: 100, videoFps: 30 });
    expect(s.reps[0]!.rotation).toEqual([]);
  });

  it("投球が 1 本もない練習は写さない", () => {
    expect(toSession(viewOf(practice("p1", "2026-10-05", ["a"]), [{ footage: footage("a") }]))).toBeUndefined();
  });
});

describe("手元の練習を読む", () => {
  const lib = {
    practices: vi.fn(async () => [practice("new", "2026-10-06", ["c"]), practice("empty", "2026-10-07", ["d"]), practice("old-b", "2026-10-01", ["b"], "2026-10-01T02:00:00Z"), practice("old-a", "2026-10-01", ["a"], "2026-10-01T01:00:00Z")]),
    get: vi.fn(async (id: string) => (id === "d" ? { ...footage(id), links: { ...footage(id).links, throws: null } } : footage(id))),
    throws: vi.fn(async (f: Footage) => analysis([rep(1, 0.45)], f.id === "a" ? "left" : "right")),
  } as unknown as FootageLibrary;

  it("古い順（同じ日なら先に作った順）に並べ、投球のない練習は数だけ数える。投げる腕はいちばん多いもの", async () => {
    const got = await loadLocalSessions(lib);
    expect(got.sessions.map((s) => s.id)).toEqual(["old-a", "old-b", "new"]);
    expect(got.skipped).toBe(1);
    expect(got.hand).toBe("right");
  });
});

describe("ホームで取り上げるレップと選手", () => {
  const zone = { p10: 0.4, p25: 0.44, p50: 0.46, p75: 0.48, p90: 0.52 };
  const all = { strideRatio: zone, frontKnee: { p10: 150, p25: 155, p50: 158, p75: 161, p90: 166 }, elbowHeight: { p10: 5, p25: 8, p50: 10, p75: 12, p90: 15 } };
  const set: ZoneSet = { all, byApproach: { drop: {}, standing: {} } };
  const session = (id: string, values: number[]) => toSession(viewOf(practice(id, "2026-10-05", ["a"]), [{ footage: footage("a"), analysis: analysis(values.map((v, i) => rep(i + 1, v))) }]))!;

  it("最新のセッション（最後）の、スコアがいちばん低い投球", () => {
    const f = focusOf([session("old", [0.3]), session("new", [0.46, 0.6, 0.47])], set)!;
    expect(f.session.id).toBe("new");
    expect(f.rep.id).toBe("a#2");
    expect(focusOf([], set)).toBeUndefined();
  });

  it("スコアを出せない投球（判定できる指標が足りない）は比べず、どれも出せなければ最初の投球", () => {
    const fewer: ZoneSet = { all: { strideRatio: zone }, byApproach: { drop: {}, standing: {} } };
    expect(focusOf([session("new", [0.46, 0.6, 0.47])], fewer)!.rep.id).toBe("a#1");
  });

  it("名前・背番号は持たず、身長と投げる腕だけ", () => {
    expect(localPlayer(180, "left")).toEqual({ position: "QB", heightCm: 180, throws: "左投げ" });
    expect(localPlayer(undefined, undefined).throws).toBe("—");
  });
});
