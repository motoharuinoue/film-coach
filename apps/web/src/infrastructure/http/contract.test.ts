// 画面と解析サービスの約束（契約）の確認。
// 見本（packages/schema/fixtures/api-samples.v1.json）は Python 側のテストが実際の API から作る。
// ここでは、見本が JSON Schema に合うこと、画面の読み込み処理と追跡のユースケースが見本を正しく扱えることを確かめる。

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { trackFootage } from "../../application/footage";
import { toReference } from "../../application/localReferences";
import { HttpFootageLibrary, parseFootage, parsePractice, parseReference, parseThrows, parseTrack } from "./httpFootageLibrary";

const SCHEMA = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../packages/schema");
const read = (name: string) => JSON.parse(readFileSync(resolve(SCHEMA, name), "utf8")) as Record<string, unknown>;
const samples = read("fixtures/api-samples.v1.json") as Record<string, Record<string, unknown>> & { jobEvents: { event: string; data: unknown }[] };

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validRecord = ajv.compile(read("video-record.v1.schema.json"));
const validTrack = ajv.compile(read("target-track.v1.schema.json"));
// 投球の解析は、骨格の列を pose-sequence.v1 で参照する
ajv.addSchema(read("pose-sequence.v1.schema.json"));
const validThrows = ajv.compile(read("throw-analysis.v1.schema.json"));
const validPractice = ajv.compile(read("practice.v1.schema.json"));
const validYouTubeSearch = ajv.compile(read("youtube-search.v1.schema.json"));
const validReference = ajv.compile(read("reference.v1.schema.json"));

const withoutLinks = (v: Record<string, unknown>) => {
  const { links: _links, ...rest } = v;
  return rest;
};

describe("API の見本が JSON Schema に合う", () => {
  it.each(["uploadBeforeTrack", "upload", "youtube", "uploadWithThrows"])("%s の記録", (key) => {
    expect(validRecord(withoutLinks(samples[key]!)), JSON.stringify(validRecord.errors)).toBe(true);
  });

  it("追跡結果", () => {
    expect(validTrack(samples.track), JSON.stringify(validTrack.errors)).toBe(true);
  });

  it("お手本", () => {
    expect(validReference(withoutLinks(samples.reference!)), JSON.stringify(validReference.errors)).toBe(true);
  });

  it("YouTube の検索", () => {
    expect(validYouTubeSearch(samples.youtubeSearch), JSON.stringify(validYouTubeSearch.errors)).toBe(true);
  });

  it("練習", () => {
    expect(validPractice(withoutLinks(samples.practice!)), JSON.stringify(validPractice.errors)).toBe(true);
  });

  it("投球の解析", () => {
    expect(validThrows(samples.throws), JSON.stringify(validThrows.errors)).toBe(true);
    // 骨格の列が pose-sequence.v1 に合わなければ失敗すること（参照が効いている）
    const broken = structuredClone(samples.throws) as { reps: { sequence: { space: string } }[] };
    broken.reps[0]!.sequence.space = "image";
    expect(validThrows(broken)).toBe(false);
  });
});

describe("画面の読み込み処理", () => {
  it("記録と、使える URL を読む", () => {
    const up = parseFootage(samples.upload!);
    expect(up).toMatchObject({ source: "upload", mediaRetained: true, trackStatus: "done", label: "#5" });
    expect(up.links.media).toBe(`/api/videos/${up.id}/media`);
    expect(up.info).toMatchObject({ fps: 30, width: 1920, height: 1080, frameCount: 60 });
  });

  it("YouTube の記録は元の動画がなく、出典を持つ", () => {
    const yt = parseFootage(samples.youtube!);
    expect(yt.mediaRetained).toBe(false);
    expect(yt.links.media).toBeNull();
    expect(yt.links.frame).toBeNull();
    expect(yt.youtube).toMatchObject({ videoId: "Qb7Throw_01", start: 134, end: 140 });
  });

  it("追跡結果の枠と関節を、組（tuple）から名前付きの値にする", () => {
    const t = parseTrack(samples.track!);
    expect(t.frames).toHaveLength(60);
    expect(t.frames[0]!.box).toMatchObject({ x1: 100, y1: 300, x2: 170, y2: 480 });
    expect(t.frames[0]!.kp).toHaveLength(17);
    expect(t.frames.filter((f) => f.interpolated).map((f) => f.i)).toEqual(Array.from({ length: 12 }, (_, i) => 20 + i));
    // 50 フレーム目で場面が変わり、その先は追わない
    expect(t.cuts).toEqual([50]);
    expect(t.frames.slice(50).every((f) => f.box === null)).toBe(true);
  });

  it("場面の切り替わりを数える前の追跡結果も読める", () => {
    const { cuts: _, ...old } = samples.track as Record<string, unknown>;
    expect(parseTrack(old).cuts).toEqual([]);
  });
});

describe("投球の解析の読み込み", () => {
  it("投球ごとのイベント・フェーズ・指標と、骨格の列を名前付きの値にする", () => {
    const a = parseThrows(samples.throws!);
    expect(a).toMatchObject({ hand: "right", heightM: 1.8, camera: "side", warnings: [] });
    expect(a.reps).toHaveLength(1);
    const r = a.reps[0]!;
    expect(r.start).toBeLessThan(r.start + r.events.release);
    expect(r.phases.map((p) => p.key)).toEqual(["drop", "set", "stride", "release", "follow"]);
    expect(r.metrics.strideRatio).toBeGreaterThan(0);
    expect(r.sequence.frames[0]!.kp).toHaveLength(17);
    expect(r.sequence.frames[0]!.kp[0]).toEqual({ x: expect.any(Number), y: expect.any(Number), c: expect.any(Number) });
  });

  it("投球を解析した記録には、結果へのリンクが付く", () => {
    const f = parseFootage(samples.uploadWithThrows!);
    expect(f.links.throws).toBe(`/api/videos/${f.id}/throws`);
    expect(parseFootage(samples.upload!).links.throws).toBeNull();
  });
});

describe("お手本の読み込み", () => {
  it("登録を読み、元の映像と投球の解析結果と合わせて、デモと同じ形に写せる", () => {
    const r = parseReference(samples.reference!);
    expect(r).toMatchObject({ kind: "model", trustedChannel: false, playerHeightCm: 188, manual: { pinned: false, excluded: false, stars: 3 } });
    expect(r.videoId).toBe((samples.referenceRequest as { footageId: string }).footageId);
    const footage = parseFootage(samples.referenceFootage!);
    expect(footage.source).toBe("youtube");
    const ref = toReference(r, footage, parseThrows(samples.throws!));
    expect(ref.reps.length).toBeGreaterThan(0);
    expect(ref.stats.camera).toBe("side");
    expect((samples.references as unknown as Record<string, unknown>[]).map(parseReference).map((x) => x.id)).toEqual([r.id]);
  });
});

describe("練習の読み込み", () => {
  it("まとめた映像の ID を、まとめた順に読む", () => {
    const p = parsePractice(samples.practice!);
    expect(p).toMatchObject({ name: "投球ドリル", date: "2026-10-05", kind: "drill", camera: "side", memo: "" });
    expect(p.videoIds).toEqual((samples.practiceRequest as { videoIds: string[] }).videoIds);
    const list = samples.practices as unknown as Record<string, unknown>[];
    expect(list.map(parsePractice).map((x) => x.id)).toEqual([p.id]);
  });
});

describe("HTTP の実装（fetch と EventSource を差し替える）", () => {
  class FakeEventSource {
    static last: FakeEventSource | undefined;
    listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
    onerror: ((e: Event) => void) | null = null;
    closed = false;
    constructor(readonly url: string) {
      FakeEventSource.last = this;
    }
    addEventListener(type: string, fn: (e: MessageEvent) => void) {
      (this.listeners[type] ??= []).push(fn);
    }
    close() {
      this.closed = true;
    }
    replay(events: { event: string; data: unknown }[]) {
      for (const e of events) for (const fn of this.listeners[e.event] ?? []) fn({ data: JSON.stringify(e.data) } as MessageEvent);
    }
  }

  beforeEach(() => {
    FakeEventSource.last = undefined;
  });

  const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("追跡を始め、進み具合を受け取り、終わったら要約を返す", async () => {
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("http://127.0.0.1:8787/api/videos/000000000001/track");
      expect(JSON.parse(String(init?.body))).toEqual(samples.trackRequest);
      return jsonResponse(samples.jobAccepted, 202);
    }) as unknown as typeof globalThis.fetch;
    const lib = new HttpFootageLibrary("http://127.0.0.1:8787/", { fetch, eventSource: (u) => new FakeEventSource(u) });
    const progress = vi.fn();
    const hint = samples.trackRequest as unknown as { t: number; x: number; y: number; label: string };
    const done = trackFootage(lib, "000000000001", hint, progress);
    await vi.waitFor(() => expect(FakeEventSource.last).toBeDefined());
    FakeEventSource.last!.replay(samples.jobEvents);
    await expect(done).resolves.toMatchObject({ coverage: 0.8333, segments: 2, interpolated: 12 });
    expect(progress).toHaveBeenCalled();
    expect(FakeEventSource.last!.url).toBe("http://127.0.0.1:8787/api/jobs/job-1/events");
    expect(FakeEventSource.last!.closed).toBe(true);
  });

  it("失敗の出来事は、理由を付けて失敗にする", async () => {
    const lib = new HttpFootageLibrary("http://x", { fetch: (async () => jsonResponse(samples.jobAccepted, 202)) as unknown as typeof fetch, eventSource: (u) => new FakeEventSource(u) });
    const done = trackFootage(lib, "000000000001", { t: 1, x: 1, y: 1, label: "" }, () => undefined);
    await vi.waitFor(() => expect(FakeEventSource.last).toBeDefined());
    FakeEventSource.last!.replay([{ event: "failed", data: { message: "1.00 秒の (1, 1) に人が見つかりません" } }]);
    await expect(done).rejects.toThrow("見つかりません");
  });

  it("エラーの応答は、解析サービスの説明をそのまま伝える", async () => {
    const lib = new HttpFootageLibrary("http://x", { fetch: (async () => jsonResponse({ detail: "区間は 60 秒以内にしてください" }, 400)) as unknown as typeof fetch });
    await expect(lib.importYouTube("https://youtu.be/Qb7Throw_01", 0, 90)).rejects.toThrow("60 秒");
  });

  it("つながらないときは、起動のしかたを伝える", async () => {
    const lib = new HttpFootageLibrary("http://x", {
      fetch: (async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch,
    });
    await expect(lib.health()).rejects.toThrow("film-coach serve");
  });

  it("身長を送って投球を解析し、結果を読む", async () => {
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("http://127.0.0.1:8787/api/videos/000000000003/throws");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual(samples.throwsRequest);
      return jsonResponse(samples.throws);
    }) as unknown as typeof globalThis.fetch;
    const lib = new HttpFootageLibrary("http://127.0.0.1:8787", { fetch });
    const a = await lib.analyzeThrows("000000000003", samples.throwsRequest as unknown as { heightCm: number; camera: "side" });
    expect(a.reps[0]!.index).toBe(1);
  });

  it("まだ解析していない映像の結果は取りに行かない", async () => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch;
    const lib = new HttpFootageLibrary("http://127.0.0.1:8787", { fetch });
    await expect(lib.throws(parseFootage(samples.upload!))).rejects.toThrow("まだ解析していません");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("練習を作り、消す", async () => {
    const calls: { url: string; method?: string; body?: unknown }[] = [];
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return init?.method === "DELETE" ? new Response(null, { status: 204 }) : jsonResponse(samples.practice, 201);
    }) as unknown as typeof globalThis.fetch;
    const lib = new HttpFootageLibrary("http://127.0.0.1:8787", { fetch });
    const input = samples.practiceRequest as unknown as Parameters<typeof lib.createPractice>[0];
    const p = await lib.createPractice(input);
    await lib.deletePractice(p.id);
    expect(calls).toEqual([
      { url: "http://127.0.0.1:8787/api/practices", method: "POST", body: samples.practiceRequest },
      { url: `http://127.0.0.1:8787/api/practices/${p.id}`, method: "DELETE", body: undefined },
    ]);
  });

  it("YouTube の候補を探す。キーそのものは画面に来ない", async () => {
    const urls: string[] = [];
    const fetch = vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url));
      return jsonResponse(String(url).includes("/status") ? samples.youtubeStatus : samples.youtubeSearch);
    }) as unknown as typeof globalThis.fetch;
    const lib = new HttpFootageLibrary("http://127.0.0.1:8787", { fetch });
    const status = await lib.youtubeStatus();
    expect(status.configured).toBe(true);
    expect(JSON.stringify(status)).not.toMatch(/key/i);
    const r = await lib.searchYouTube("QB throwing mechanics", { creativeCommonsOnly: true, max: 3 });
    expect(urls[1]).toBe("http://127.0.0.1:8787/api/youtube/search?q=QB+throwing+mechanics&cc=true&max=3");
    expect(r.candidates[0]).toMatchObject({ videoId: expect.stringMatching(/^[A-Za-z0-9_-]{11}$/), license: "youtube" });
    expect(r.quota.remaining).toBe(r.quota.limit - r.quota.used);
    expect(r.quota.used).toBeGreaterThanOrEqual(102); // 検索 1 回ぶん以上
  });

  it("お手本を登録し、調整し、統計を取り直し、外す", async () => {
    const calls: { url: string; method?: string; body?: unknown }[] = [];
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return init?.method === "DELETE" ? new Response(null, { status: 204 }) : jsonResponse(samples.reference, 201);
    }) as unknown as typeof globalThis.fetch;
    const lib = new HttpFootageLibrary("http://127.0.0.1:8787", { fetch });
    const req = samples.referenceRequest as unknown as Parameters<typeof lib.registerReference>[0];
    const r = await lib.registerReference(req);
    await lib.updateReference(r.id, { manual: { pinned: true, excluded: false, stars: 5 } });
    await lib.refreshReference(r.id);
    await lib.deleteReference(r.id);
    const base = "http://127.0.0.1:8787/api/references";
    expect(calls).toEqual([
      { url: base, method: "POST", body: samples.referenceRequest },
      { url: `${base}/${r.id}`, method: "PATCH", body: { manual: { pinned: true, excluded: false, stars: 5 } } },
      { url: `${base}/${r.id}/refresh`, method: "POST", body: undefined },
      { url: `${base}/${r.id}`, method: "DELETE", body: undefined },
    ]);
  });
});
