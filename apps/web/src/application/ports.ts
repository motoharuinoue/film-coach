// アプリケーション層が外側に求める窓口（ポート）。実装は infrastructure 層に置き、
// composition.ts で差し込む。M1 ではデモ実装を解析サービス（HTTP）の実装に差し替える。

import type { CameraAngle } from "../domain/camera";
import type { AnalyzedRep, Player, Reference, Session, SessionKind } from "../domain/entities";
import type { Drill, DrillInput } from "../domain/drill";
import type { Footage, TargetTrack, TrackHint } from "../domain/footage";
import type { MetricEvaluation } from "../domain/judgement";
import type { MetricKey } from "../domain/metrics";
import type { PoseFrame } from "../domain/pose";
import type { Practice, PracticeInput } from "../domain/practice";
import type { LocalReference, ReferencePatch, ReferenceRequest } from "../domain/reference";
import type { ThrowAnalysis, ThrowsRequest } from "../domain/throws";
import type { QuotaStatus, YouTubeSearchResult } from "../domain/youtube";
import type { ManualAdjust } from "../domain/weighting";

export interface SessionRepository {
  player(): Player;
  list(): Session[];
  get(id: string): Session | undefined;
  /** ホームで取り上げるレップ（最新セッションの、いちばん気になる 1 本） */
  focus(): { session: Session; rep: AnalyzedRep };
}

/** 改善点に添えるドリル動画。youtubeId があれば YouTube で開ける（デモの架空の動画にはない） */
export type DrillPick = { label: string; channel: string; at: string; youtubeId?: string; startSec?: number };

export interface ReferenceRepository {
  list(): Reference[];
  get(id: string): Reference | undefined;
  /** その指標を、お手本の範囲から外れた側（小さい／大きい）に応じて直すドリル動画 */
  drillFor(key: MetricKey, side: "low" | "high"): DrillPick | undefined;
}

/** お手本の手動調整（ピン留め・除外・星）の保存先 */
export interface ManualAdjustmentStore {
  load(): Record<string, ManualAdjust> | undefined;
  save(manual: Record<string, ManualAdjust>): void;
}

/**
 * 判定結果を文章にする（ADR-0003）。数値は判定結果からだけ取り、文章の側で数値を作らない。
 * いまはテンプレート、M3 で Ollama のローカル LLM の実装を足す。
 */
export interface FindingWriter {
  write(evaluation: MetricEvaluation): { title: string; body: string };
}

// ---- 取り込みと解析 ----

export type VideoMeta = { name: string; sizeBytes: number; durationSec?: number; width?: number; height?: number };

/** 選んだ動画ファイルのメタデータを読む（ファイルは外に送らない） */
export interface VideoMetadataReader {
  read(file: Blob & { name: string }): Promise<VideoMeta>;
}

export type AnalysisInput = {
  source: { kind: "file"; name: string } | { kind: "youtube"; videoId: string; startSec: number; endSec: number };
  sessionKind: SessionKind;
  camera: CameraAngle;
};

export type AnalysisProgress = {
  /** 終わった段階の数 */
  completed: number;
  /** 骨格推定まで進んだら、途中のフレームを見せる */
  preview?: PoseFrame;
};

export type AnalysisResult = { sessionId: string; repCount: number };

/** 解析の実行。M0 はシミュレーション、M1 で解析サービス（SSE で進み具合を受け取る）に差し替える */
export interface AnalysisGateway {
  stages(): string[];
  run(input: AnalysisInput, onProgress: (p: AnalysisProgress) => void, signal?: AbortSignal): Promise<AnalysisResult>;
}

// ---- 自分の映像（解析サービス） ----

export type TrackingProgress = { stage: "detect" | "pose" | string; done: number; total: number };
export type TrackingSummary = { videoId: string; coverage: number; segments: number; interpolated: number };

export type TrackingHandlers = {
  onProgress?: (p: TrackingProgress) => void;
  onDone: (s: TrackingSummary) => void;
  onFailed: (message: string) => void;
};

/**
 * 解析サービス（services/analyzer の HTTP API）に取り込んだ映像。
 * 公開デモでは解析サービスがないので、この実装を差し込まない（Services.footage が undefined）。
 */
export interface FootageLibrary {
  health(): Promise<{ ok: boolean; modelsReady: boolean }>;
  list(): Promise<Footage[]>;
  get(id: string): Promise<Footage>;
  upload(file: Blob & { name: string }, onProgress?: (ratio: number) => void): Promise<Footage>;
  importYouTube(url: string, start: number, end: number): Promise<Footage>;
  /** API の相対パス（links の値）を、画面から使える URL にする */
  url(path: string): string;
  frameUrl(footage: Footage, t: number): string | null;
  track(footage: Footage): Promise<TargetTrack>;
  startTracking(id: string, hint: TrackHint): Promise<{ jobId: string; events: string }>;
  /** 進み具合を受け取る。戻り値で受け取りをやめる */
  follow(events: string, handlers: TrackingHandlers): () => void;
  /** 投球の解析結果（links.throws） */
  throws(footage: Footage): Promise<ThrowAnalysis>;
  /** 追跡した骨格から投球を見つけ、1 本ずつ指標を出す。骨格だけを使うので、すぐに終わる */
  analyzeThrows(id: string, req: ThrowsRequest): Promise<ThrowAnalysis>;
  /** 練習（映像のまとめ）。新しい順 */
  practices(): Promise<Practice[]>;
  practice(id: string): Promise<Practice>;
  createPractice(input: PracticeInput): Promise<Practice>;
  /** まとめを消すだけで、映像と解析結果は残す */
  deletePractice(id: string): Promise<void>;
  /** YouTube Data API のキーがあるか（キーそのものは画面に渡さない）と、今日の無料枠 */
  youtubeStatus(): Promise<{ configured: boolean; quota: QuotaStatus | null }>;
  /** お手本の候補を探す。1 回で 102 ユニット使う */
  searchYouTube(query: string, opts?: { creativeCommonsOnly?: boolean; max?: number }): Promise<YouTubeSearchResult>;
  /** 手元のお手本（新しい順） */
  references(): Promise<LocalReference[]>;
  /** 投球を解析した YouTube の映像をお手本にする。YouTube の統計を取り直す（2 ユニット） */
  registerReference(req: ReferenceRequest): Promise<LocalReference>;
  /** 種類・信頼チャンネル・手動調整を変える */
  updateReference(id: string, patch: ReferencePatch): Promise<LocalReference>;
  /** YouTube の統計を取り直す（2 ユニット） */
  refreshReference(id: string): Promise<LocalReference>;
  /** お手本の登録だけを消す（元の映像と解析結果は残す） */
  deleteReference(id: string): Promise<void>;
  /** 改善点に添えるドリル動画（新しい順） */
  drills(): Promise<Drill[]>;
  /** ドリル動画を登録する。動画は取り込まない */
  createDrill(input: DrillInput): Promise<Drill>;
  deleteDrill(id: string): Promise<void>;
}

/** 選手の身体の情報。指標の計算に使い、この端末の中にだけ保存する（リポジトリにもサーバーにも置かない） */
export interface PlayerProfileStore {
  heightCm(): number | undefined;
  saveHeightCm(cm: number): void;
}
