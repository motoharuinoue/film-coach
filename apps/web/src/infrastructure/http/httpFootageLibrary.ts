// FootageLibrary の HTTP 実装（services/analyzer の API）。
// API の JSON（packages/schema の video-record.v1 / target-track.v1 / throw-analysis.v1 / practice.v1）を、ドメインの型に読み替える。

import type { FootageLibrary, TrackingHandlers, TrackingProgress, TrackingSummary } from "../../application/ports";
import type { Footage, FootageLinks, ImagePoint, TargetTrack, TrackBox, TrackFrame, TrackHint } from "../../domain/footage";
import type { PoseSequence } from "../../domain/pose";
import type { Practice, PracticeInput } from "../../domain/practice";
import type { LocalReference, ReferencePatch, ReferenceRequest } from "../../domain/reference";
import type { ThrowAnalysis, ThrowRep, ThrowsRequest } from "../../domain/throws";
import type { QuotaStatus, YouTubeSearchResult } from "../../domain/youtube";

type Json = Record<string, unknown>;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const LINK_KEYS: (keyof FootageLinks)[] = ["self", "frame", "media", "track", "preview", "focus", "events", "throws"];

export function parseFootage(j: Json): Footage {
  const links = (j.links ?? {}) as Json;
  return {
    id: String(j.id),
    name: String(j.name),
    source: j.source === "youtube" ? "youtube" : "upload",
    info: j.info as Footage["info"],
    createdAt: String(j.createdAt),
    youtube: (j.youtube as Footage["youtube"]) ?? null,
    mediaRetained: Boolean(j.mediaRetained),
    trackStatus: j.trackStatus as Footage["trackStatus"],
    label: String(j.label ?? ""),
    errors: (j.errors as string[]) ?? [],
    links: Object.fromEntries(LINK_KEYS.map((k) => [k, (links[k] as string | null | undefined) ?? null])) as FootageLinks,
  };
}

export function parseTrack(j: Json): TargetTrack {
  const frames = (j.frames as Json[]).map(
    (f): TrackFrame => ({
      i: Number(f.i),
      t: Number(f.t),
      box: f.box ? (([x1, y1, x2, y2, score]: number[]): TrackBox => ({ x1: x1!, y1: y1!, x2: x2!, y2: y2!, score: score! }))(f.box as number[]) : null,
      kp: f.kp ? (f.kp as number[][]).map(([x, y, c]): ImagePoint => ({ x: x!, y: y!, c: c! })) : null,
      interpolated: Boolean(f.interpolated),
    }),
  );
  return {
    video: j.video as TargetTrack["video"],
    hint: j.hint as TargetTrack["hint"],
    segments: j.segments as TargetTrack["segments"],
    peopleTracked: Number(j.peopleTracked),
    // 場面の切り替わりを数える前に書き出した結果には無いので、空とみなす
    cuts: ((j.cuts as number[] | undefined) ?? []).map(Number),
    frames,
  };
}

const toSequence = (s: Json): PoseSequence => ({
  fps: Number(s.fps),
  heightM: Number(s.heightM),
  frames: (s.frames as Json[]).map((f) => ({ t: Number(f.t), kp: (f.kp as number[][]).map(([x, y, c]) => ({ x: x!, y: y!, c: c! })) })),
});

/** 投球の解析結果（throw-analysis.v1）。骨格の列の組（tuple）を、名前付きの値にする */
export function parseThrows(j: Json): ThrowAnalysis {
  return {
    video: j.video as ThrowAnalysis["video"],
    heightM: Number(j.heightM),
    camera: j.camera as ThrowAnalysis["camera"],
    hand: j.hand === "left" ? "left" : "right",
    warnings: (j.warnings as string[]) ?? [],
    // スロー再生の倍率を入れる前に書き出した結果にはないので、等速とみなす
    slowmo: Number(j.slowmo ?? 1),
    reps: (j.reps as Json[]).map(
      (r): ThrowRep => ({
        index: Number(r.index),
        start: Number(r.start),
        end: Number(r.end),
        transform: r.transform as ThrowRep["transform"],
        events: r.events as ThrowRep["events"],
        phases: r.phases as ThrowRep["phases"],
        metrics: r.metrics as ThrowRep["metrics"],
        sequence: toSequence(r.sequence as Json),
      }),
    ),
  };
}

export function parsePractice(j: Json): Practice {
  return {
    id: String(j.id),
    name: String(j.name),
    date: String(j.date),
    kind: j.kind === "game" ? "game" : "drill",
    camera: j.camera as Practice["camera"],
    memo: String(j.memo ?? ""),
    videoIds: (j.videoIds as string[]) ?? [],
    createdAt: String(j.createdAt),
  };
}

export function parseReference(j: Json): LocalReference {
  const { links: _links, schemaVersion: _v, ...rest } = j;
  return rest as unknown as LocalReference;
}

type EventSourceLike = { addEventListener(type: string, fn: (e: MessageEvent) => void): void; close(): void; onerror: ((e: Event) => void) | null };

export type HttpDeps = {
  fetch: typeof fetch;
  eventSource: (url: string) => EventSourceLike;
};

const defaultDeps = (): HttpDeps => ({
  fetch: (...a) => globalThis.fetch(...a),
  eventSource: (url) => new EventSource(url),
});

export class HttpFootageLibrary implements FootageLibrary {
  private readonly base: string;
  private readonly deps: HttpDeps;

  constructor(baseUrl: string, deps: Partial<HttpDeps> = {}) {
    this.base = baseUrl.replace(/\/$/, "");
    this.deps = { ...defaultDeps(), ...deps };
  }

  url(path: string) {
    return /^https?:\/\//.test(path) ? path : `${this.base}${path}`;
  }

  private async json(path: string, init?: RequestInit): Promise<Json> {
    let res: Response;
    try {
      res = await this.deps.fetch(this.url(path), init);
    } catch {
      throw new ApiError("解析サービスにつながりません。`uv run film-coach serve` で起動してください", 0);
    }
    const body = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok) throw new ApiError(typeof body.detail === "string" ? body.detail : `解析サービスがエラーを返しました（${res.status}）`, res.status);
    return body;
  }

  async health() {
    const j = await this.json("/api/health");
    return { ok: Boolean(j.ok), modelsReady: Boolean(j.modelsReady) };
  }

  async list() {
    return ((await this.json("/api/videos")) as unknown as Json[]).map(parseFootage);
  }

  async get(id: string) {
    return parseFootage(await this.json(`/api/videos/${encodeURIComponent(id)}`));
  }

  /** 進み具合を出すため XMLHttpRequest で送る */
  upload(file: Blob & { name: string }, onProgress?: (ratio: number) => void): Promise<Footage> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", this.url("/api/videos"));
      xhr.responseType = "json";
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        const body = (xhr.response ?? {}) as Json;
        if (xhr.status === 201) resolve(parseFootage(body));
        else reject(new ApiError(typeof body.detail === "string" ? body.detail : `アップロードに失敗しました（${xhr.status}）`, xhr.status));
      };
      xhr.onerror = () => reject(new ApiError("解析サービスにつながりません", 0));
      const form = new FormData();
      form.append("file", file, file.name);
      xhr.send(form);
    });
  }

  async importYouTube(url: string, start: number, end: number) {
    const body = JSON.stringify({ url, start, end });
    return parseFootage(await this.json("/api/videos/youtube", { method: "POST", headers: { "Content-Type": "application/json" }, body }));
  }

  frameUrl(footage: Footage, t: number) {
    return footage.links.frame ? `${this.url(footage.links.frame)}?t=${t.toFixed(2)}` : null;
  }

  async track(footage: Footage) {
    if (!footage.links.track) throw new ApiError("追跡はまだ終わっていません", 404);
    return parseTrack(await this.json(footage.links.track));
  }

  async startTracking(id: string, hint: TrackHint) {
    const j = await this.json(`/api/videos/${encodeURIComponent(id)}/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(hint),
    });
    return { jobId: String(j.jobId), events: String(j.events) };
  }

  async throws(footage: Footage) {
    if (!footage.links.throws) throw new ApiError("投球はまだ解析していません", 404);
    return parseThrows(await this.json(footage.links.throws));
  }

  async analyzeThrows(id: string, req: ThrowsRequest) {
    const j = await this.json(`/api/videos/${encodeURIComponent(id)}/throws`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    return parseThrows(j);
  }

  async practices() {
    return ((await this.json("/api/practices")) as unknown as Json[]).map(parsePractice);
  }

  async practice(id: string) {
    return parsePractice(await this.json(`/api/practices/${encodeURIComponent(id)}`));
  }

  async createPractice(input: PracticeInput) {
    const j = await this.json("/api/practices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    return parsePractice(j);
  }

  async deletePractice(id: string) {
    await this.json(`/api/practices/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async youtubeStatus() {
    const j = await this.json("/api/youtube/status");
    return { configured: Boolean(j.configured), quota: (j.quota as QuotaStatus | null) ?? null };
  }

  async searchYouTube(query: string, opts: { creativeCommonsOnly?: boolean; max?: number } = {}) {
    const params = new URLSearchParams({ q: query, cc: String(Boolean(opts.creativeCommonsOnly)), max: String(opts.max ?? 12) });
    return (await this.json(`/api/youtube/search?${params}`)) as unknown as YouTubeSearchResult;
  }

  async references() {
    return ((await this.json("/api/references")) as unknown as Json[]).map(parseReference);
  }

  async registerReference(req: ReferenceRequest) {
    return parseReference(await this.json("/api/references", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) }));
  }

  async updateReference(id: string, patch: ReferencePatch) {
    const init = { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) };
    return parseReference(await this.json(`/api/references/${encodeURIComponent(id)}`, init));
  }

  async refreshReference(id: string) {
    return parseReference(await this.json(`/api/references/${encodeURIComponent(id)}/refresh`, { method: "POST" }));
  }

  async deleteReference(id: string) {
    await this.json(`/api/references/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  follow(events: string, handlers: TrackingHandlers) {
    const es = this.deps.eventSource(this.url(events));
    let finished = false;
    const data = (e: MessageEvent) => JSON.parse(String(e.data)) as Json;
    es.addEventListener("progress", (e) => handlers.onProgress?.(data(e) as unknown as TrackingProgress));
    es.addEventListener("done", (e) => {
      finished = true;
      es.close();
      handlers.onDone(data(e) as unknown as TrackingSummary);
    });
    es.addEventListener("failed", (e) => {
      finished = true;
      es.close();
      handlers.onFailed(String(data(e).message ?? "追跡に失敗しました"));
    });
    es.onerror = () => {
      // 終わったあとに接続が切れるのは正常。途中で切れたら知らせる
      if (!finished) {
        finished = true;
        es.close();
        handlers.onFailed("解析サービスとの接続が切れました");
      }
    };
    return () => {
      finished = true;
      es.close();
    };
  }
}
