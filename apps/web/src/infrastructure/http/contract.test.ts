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
import { HttpFootageLibrary, parseFootage, parseTrack } from "./httpFootageLibrary";

const SCHEMA = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../packages/schema");
const read = (name: string) => JSON.parse(readFileSync(resolve(SCHEMA, name), "utf8")) as Record<string, unknown>;
const samples = read("fixtures/api-samples.v1.json") as Record<string, Record<string, unknown>> & { jobEvents: { event: string; data: unknown }[] };

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validRecord = ajv.compile(read("video-record.v1.schema.json"));
const validTrack = ajv.compile(read("target-track.v1.schema.json"));

const withoutLinks = (v: Record<string, unknown>) => {
  const { links: _links, ...rest } = v;
  return rest;
};

describe("API の見本が JSON Schema に合う", () => {
  it.each(["uploadBeforeTrack", "upload", "youtube"])("%s の記録", (key) => {
    expect(validRecord(withoutLinks(samples[key]!)), JSON.stringify(validRecord.errors)).toBe(true);
  });

  it("追跡結果", () => {
    expect(validTrack(samples.track), JSON.stringify(validTrack.errors)).toBe(true);
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
    await expect(done).resolves.toMatchObject({ coverage: 1, segments: 2, interpolated: 12 });
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
});
