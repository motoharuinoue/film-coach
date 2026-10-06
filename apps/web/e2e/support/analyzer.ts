// 偽の解析サービス。page.route で画面からの API の呼び出しを受け、API の見本（packages/schema/fixtures/api-samples.v1.json）で応答する。
// 見本は、Python 側のテスト（services/analyzer/tests/test_api_samples.py）が実際の API から作るもので、画面と解析サービスの約束そのもの。
//
// 見本は API ごとに別々の手順で作った断片なので、ここで 1 つの手元のライブラリ（映像・練習・お手本・ドリル動画・正解）にまとめる。
// 見本では、投球の解析（60 fps・193 フレーム）の映像の記録が、追跡の前の状態（30 fps・60 フレーム）のままになっている
// （追跡の結果を API を通さずに置いて作るため）。画面が実際に受け取るのは追跡を済ませた映像なので、自分の映像とお手本の映像は
// 追跡済みにし、投球の解析と同じ長さにそろえる。追跡の結果も、見本の 60 フレームをくり返して同じ長さにする。
//
// 書き込み（追跡・投球の解析・練習・お手本の手動調整・正解の保存）は覚えて、次の読み込みに映す。
// 誤差の計算は解析サービスの役目なので、正解が保存されていれば、見本の誤差の結果をそのまま返す。

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import type { BrowserContext, Route } from "@playwright/test";
import { ANALYZER_URL } from "./env";

type Json = Record<string, unknown>;
type Info = { name: string; fps: number; width: number; height: number; frameCount: number; duration: number };
type Video = Json & { id: string; name: string; info: Info; trackStatus: string; label: string; mediaRetained: boolean; links: Record<string, string | null> };
type Track = Json & { video: Json; frames: (Json & { i: number; t: number })[]; segments: Json[]; cuts: number[] };
type Throws = Json & { video: Json & { fps: number; frameCount: number }; heightM: number; camera: string; reps: (Json & { index: number; start: number; end: number })[] };
type Label = { rep: number; plant: number | null; release: number | null };
type Annotation = Json & { videoId: string; throws: Label[]; frames: (Json & { frame: number })[] };
type EvaluationThrow = Json & { rep: number; frames: number[] };
type Evaluation = Json & { targets: (Json & { video: Json & { id: string }; throws: EvaluationThrow[]; annotation: Annotation | null })[]; report: Json & { groups: Record<string, unknown> } };

type Samples = {
  health: Json;
  uploadBeforeTrack: Video;
  upload: Video;
  youtube: Video;
  uploadWithThrows: Video;
  referenceFootage: Video;
  track: Track;
  jobAccepted: { jobId: string; events: string };
  jobEvents: { event: string; data: Json }[];
  throws: Throws;
  practices: (Json & { id: string })[];
  references: (Json & { id: string; manual: Json })[];
  drills: (Json & { id: string })[];
  annotation: Annotation;
  evaluation: Evaluation;
  youtubeStatus: Json;
  youtubeSearch: Json;
};

const SAMPLES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../packages/schema/fixtures/api-samples.v1.json");
export const samples = JSON.parse(readFileSync(SAMPLES, "utf8")) as Samples;

/** 見本の ID（解析サービスが作った順の連番） */
export const IDS = {
  /** 追跡を済ませ、投球はまだ解析していない映像（練習の 2 本目） */
  upload: samples.upload.id,
  /** YouTube から取り込んだ映像（元の動画は消している） */
  youtube: samples.youtube.id,
  /** 投球を解析した映像（練習の 1 本目、精度の評価の対象） */
  throws: samples.uploadWithThrows.id,
  practice: samples.practices[0]!.id,
  referenceFootage: samples.referenceFootage.id,
  reference: samples.references[0]!.id,
  drill: samples.drills[0]!.id,
} as const;

// ---- 小さな PNG（フレームの画像とサムネイルの代わり）。フレーム番号で色を変え、トレースで見分けられるようにする ----

function chunk(type: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}

export function png(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8 ビットの RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const frameImage = (n: number) => png(160, 90, [20 + (n * 37) % 120, 40 + (n * 11) % 100, 60]);

// ---- 手元のライブラリ ----

/** 投球の解析の映像（60 fps・193 フレーム）。自分の映像とお手本の映像を、この長さにそろえる */
const CLIP = samples.throws.video;

function trackedVideo(v: Video): Video {
  return {
    ...structuredClone(v),
    info: { ...v.info, fps: CLIP.fps, frameCount: CLIP.frameCount, duration: Math.round((CLIP.frameCount / CLIP.fps) * 1000) / 1000 },
    trackStatus: "done",
    label: v.label || "#5",
    links: { ...v.links, track: `/api/videos/${v.id}/track` },
  };
}

function trackOf(v: Video): Track {
  const s = samples.track;
  return {
    ...structuredClone(s),
    video: { ...s.video, name: v.name, fps: CLIP.fps, frameCount: CLIP.frameCount },
    frames: Array.from({ length: CLIP.frameCount }, (_, i) => ({ ...structuredClone(s.frames[i % s.frames.length]!), i, t: i / CLIP.fps })),
    segments: [{ trackId: 2, start: 0, end: CLIP.frameCount - 1 }],
    cuts: [],
  };
}

/** 見本の正解で付けた瞬間（接地・リリース）。評価の対象のフレームから除くと、区間の 25・50・75% のフレームが残る */
const sampleLabelFrames = new Set(samples.annotation.throws.flatMap((t) => [t.plant, t.release]));

/** 正解がまだないときの誤差の結果（形は evaluation.v1） */
function emptyReport(): Json {
  const none = { raw: null, final: null };
  return {
    videos: 0,
    throws: 0,
    frames: 0,
    joints: none,
    groups: Object.fromEntries(Object.keys(samples.evaluation.report.groups).map((g) => [g, none])),
    events: { plant: null, release: null },
    metrics: {},
    details: { joints: [], events: [], metrics: [] },
  };
}

/** 一覧は、解析サービスと同じく新しい順に並べる（同じなら登録した順） */
const newest = <T>(xs: T[], key: (x: T) => string) => xs.map((x, i) => ({ x, i, k: key(x) })).sort((a, b) => b.k.localeCompare(a.k) || a.i - b.i).map((e) => e.x);

export type Call = { method: string; path: string; query: URLSearchParams; body?: unknown; at: number };

export class FakeAnalyzer {
  /** false なら、すべての呼び出しを「つながらない」にする（解析サービスが止まっている） */
  online = true;
  readonly calls: Call[] = [];
  /** 偽の解析サービスが知らない呼び出し。あればテストを失敗にする */
  readonly unhandled: string[] = [];
  readonly videos = new Map<string, Video>();
  readonly tracks = new Map<string, Track>();
  readonly analyses = new Map<string, Throws>();
  readonly practices = new Map<string, Json & { id: string }>();
  readonly references = new Map<string, Json & { id: string; manual: Json }>();
  readonly drills = new Map<string, Json & { id: string }>();
  readonly annotations = new Map<string, Annotation>();
  /** 保存の応答を遅らせる時間（保存が終わるのを待ってから次へ進むかを確かめる） */
  saveDelayMs = 0;
  private seq = 100;

  constructor() {
    const videos = [trackedVideo(samples.upload), structuredClone(samples.youtube), trackedVideo(samples.uploadWithThrows), trackedVideo(samples.referenceFootage)];
    for (const v of videos) {
      this.videos.set(v.id, v);
      if (v.trackStatus === "done") this.tracks.set(v.id, v.id === IDS.youtube ? structuredClone(samples.track) : trackOf(v));
    }
    for (const id of [IDS.throws, IDS.referenceFootage]) this.analyses.set(id, structuredClone(samples.throws));
    for (const p of samples.practices) this.practices.set(p.id, structuredClone(p));
    for (const r of samples.references) this.references.set(r.id, structuredClone(r));
    for (const d of samples.drills) this.drills.set(d.id, structuredClone(d));
    this.annotations.set(IDS.throws, structuredClone(samples.annotation));
  }

  /** 見本の映像の記録を写して、新しい ID の映像を作る */
  private newVideo(from: Video, name: string): Video {
    const id = String(++this.seq).padStart(12, "0");
    const links = Object.fromEntries(Object.entries(from.links).map(([k, v]) => [k, v && v.replace(from.id, id)]));
    const v: Video = { ...structuredClone(from), id, name, info: { ...from.info, name }, createdAt: new Date().toISOString(), links };
    this.videos.set(id, v);
    return v;
  }

  /** お手本をもう 1 本足す（見本のお手本と同じ投球の解析を、別の YouTube の区間から登録したもの） */
  addReference() {
    const footage = this.newVideo(trackedVideo(samples.referenceFootage), samples.referenceFootage.name);
    this.tracks.set(footage.id, trackOf(footage));
    this.analyses.set(footage.id, structuredClone(samples.throws));
    const from = samples.references[0]!;
    const id = String(++this.seq).padStart(12, "0");
    const links = { self: `/api/references/${id}`, footage: `/api/videos/${footage.id}`, throws: `/api/videos/${footage.id}/throws` };
    this.references.set(id, { ...structuredClone(from), id, videoId: footage.id, title: "QB の投げ方 8", createdAt: new Date().toISOString(), links });
  }

  /** 追跡の前の映像にする（本人を選ぶところから始める） */
  untrack(id: string) {
    const v = this.videos.get(id)!;
    this.videos.set(id, { ...v, trackStatus: "none", label: "", links: { ...v.links, track: null, throws: null, events: null } });
    this.tracks.delete(id);
    this.analyses.delete(id);
  }

  async install(context: BrowserContext) {
    await context.route((url) => url.origin === ANALYZER_URL, (route) => this.handle(route));
    // YouTube のサムネイル（自分の映像の一覧）
    await context.route("https://i.ytimg.com/**", (route) => route.fulfill({ contentType: "image/png", body: png(48, 36, [200, 30, 30]) }));
  }

  /** 呼び出しのうち、method と経路が合うもの */
  find(method: string, path: string | RegExp) {
    return this.calls.filter((c) => c.method === method && (typeof path === "string" ? c.path === path : path.test(c.path)));
  }

  evaluation(): Evaluation {
    const e = structuredClone(samples.evaluation);
    for (const t of e.targets) {
      const saved = this.annotations.get(t.video.id) ?? null;
      t.annotation = saved && { ...saved, schemaVersion: 1 };
      t.throws = t.throws.map((x) => {
        const label = saved?.throws.find((l) => l.rep === x.rep);
        const frames = [...x.frames.filter((f) => !sampleLabelFrames.has(f)), label?.plant, label?.release].filter((f): f is number => f != null);
        return { ...x, frames: [...new Set(frames)].sort((a, b) => a - b) };
      });
    }
    if (![...this.annotations.values()].some((a) => a.frames.length > 0 || a.throws.some((t) => t.plant !== null || t.release !== null))) e.report = emptyReport() as Evaluation["report"];
    return e;
  }

  private async handle(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    let sent: unknown;
    try {
      sent = req.postDataJSON() ?? undefined;
    } catch {
      // JSON でない本文（動画のアップロード）
      sent = req.postDataBuffer()?.toString("latin1");
    }
    const call: Call = { method: req.method(), path: url.pathname, query: url.searchParams, body: sent, at: Date.now() };
    this.calls.push(call);
    if (!this.online) return route.abort("connectionrefused");

    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
    const notFound = () => json({ detail: "見つかりません" }, 404);
    const p = url.pathname.split("/").slice(1); // ["api", ...]
    const key = `${req.method()} /${p.map((s, i) => (i >= 2 && /^[0-9a-f]{12}$|^job-\d+$/.test(s) ? ":id" : s)).join("/")}`;
    const id = p[2] ?? "";
    const body = call.body as Json;

    switch (key) {
      case "GET /api/health":
        return json(samples.health);
      case "GET /api/videos":
        return json(newest([...this.videos.values()], (v) => String(v.createdAt)));
      case "POST /api/videos": {
        // 送られた動画の名前で、追跡の前の映像を作る
        const name = /filename="([^"]+)"/.exec(String(sent))?.[1] ?? "upload.mov";
        return json(this.newVideo(samples.uploadBeforeTrack, name), 201);
      }
      case "POST /api/videos/youtube": {
        // 区間だけを取り込んだ、追跡の前の映像（お手本の選手を選ぶまでは元の動画を残している）
        const videoId = new URL(String(body.url)).searchParams.get("v") ?? "";
        const v = this.newVideo(samples.referenceFootage, `YouTube ${videoId}`);
        v.youtube = { ...(v.youtube as Json), videoId, start: body.start, end: body.end, url: body.url };
        v.links.throws = null;
        return json(v, 201);
      }
      case "GET /api/videos/:id":
        return this.videos.has(id) ? json(this.videos.get(id)) : notFound();
      case "GET /api/videos/:id/track":
        return this.tracks.has(id) ? json(this.tracks.get(id)) : notFound();
      case "GET /api/videos/:id/throws":
        return this.analyses.has(id) ? json(this.analyses.get(id)) : notFound();
      case "POST /api/videos/:id/throws": {
        const a: Throws = { ...structuredClone(samples.throws), heightM: (body.heightCm as number) / 100, camera: (body.camera as string) ?? "side", slowmo: body.slowmo ?? 1, approachMode: body.approach ?? "auto" };
        this.analyses.set(id, a);
        const v = this.videos.get(id)!;
        this.videos.set(id, { ...v, links: { ...v.links, throws: `/api/videos/${id}/throws` } });
        return json(a);
      }
      case "POST /api/videos/:id/track": {
        const v = this.videos.get(id)!;
        this.videos.set(id, trackedVideo({ ...v, label: String(body.label ?? "") }));
        this.tracks.set(id, trackOf(v));
        return json({ ...samples.jobAccepted, events: `/api/jobs/job-${id}/events` }, 202);
      }
      case "GET /api/jobs/:id/events": {
        const stream = samples.jobEvents.map((e) => `event: ${e.event}\ndata: ${JSON.stringify({ ...e.data, ...(e.event === "done" ? { videoId: p[2]!.slice(4) } : {}) })}\n\n`).join("");
        return route.fulfill({ status: 200, contentType: "text/event-stream", headers: { "access-control-allow-origin": "*" }, body: stream });
      }
      case "GET /api/videos/:id/frame": {
        const n = Number(url.searchParams.get("i") ?? Math.round(Number(url.searchParams.get("t") ?? 0) * 100));
        return route.fulfill({ contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: frameImage(n) });
      }
      case "GET /api/videos/:id/media":
        // 動画そのものは返さない（再生できない映像として扱われる）
        return route.fulfill({ status: 200, contentType: "video/mp4", headers: { "access-control-allow-origin": "*" }, body: "" });
      case "PUT /api/videos/:id/annotation": {
        const a: Annotation = { schemaVersion: 1, videoId: id, throws: body.throws as Label[], frames: body.frames as Annotation["frames"], updatedAt: new Date().toISOString() };
        this.annotations.set(id, a);
        if (this.saveDelayMs) await new Promise((r) => setTimeout(r, this.saveDelayMs));
        return json(a);
      }
      case "GET /api/evaluation":
        return json(this.evaluation());
      case "GET /api/practices":
        return json(newest([...this.practices.values()], (p) => `${String(p.date)} ${String(p.createdAt)}`));
      case "GET /api/practices/:id":
        return this.practices.has(id) ? json(this.practices.get(id)) : notFound();
      case "POST /api/practices": {
        const nid = String(++this.seq).padStart(12, "0");
        const practice = { schemaVersion: 1, id: nid, ...body, createdAt: new Date().toISOString(), links: { self: `/api/practices/${nid}` } };
        this.practices.set(nid, practice);
        return json(practice, 201);
      }
      case "DELETE /api/practices/:id":
        this.practices.delete(id);
        return json({ ok: true });
      case "GET /api/references":
        return json(newest([...this.references.values()], (r) => String(r.createdAt)));
      case "PATCH /api/references/:id": {
        const r = this.references.get(id);
        if (!r) return notFound();
        const next = { ...r, ...(body as Json & { manual?: Json }), manual: { ...r.manual, ...((body.manual as Json) ?? {}) } };
        this.references.set(id, next);
        return json(next);
      }
      case "GET /api/drills":
        return json(newest([...this.drills.values()], (d) => String(d.createdAt)));
      case "POST /api/drills": {
        const nid = String(++this.seq).padStart(12, "0");
        const drill = { schemaVersion: 1, id: nid, ...body, createdAt: new Date().toISOString(), links: { self: `/api/drills/${nid}` } };
        this.drills.set(nid, drill);
        return json(drill, 201);
      }
      case "GET /api/youtube/status":
        return json(samples.youtubeStatus);
      case "GET /api/youtube/search":
        return json({ ...samples.youtubeSearch, query: url.searchParams.get("q") });
      default:
        this.unhandled.push(`${req.method()} ${url.pathname}${url.search}`);
        return json({ detail: "偽の解析サービスにない API です" }, 404);
    }
  }
}
