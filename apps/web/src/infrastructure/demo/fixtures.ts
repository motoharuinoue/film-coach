// デモ用の固定データ。選手・チャンネル・動画はすべて架空。
// 骨格は合成し、解析はドメインの処理をそのまま通す（analyzer.ts）。

import type { CameraAngle } from "../../domain/camera";
import type { Player, Reference, Session } from "../../domain/entities";
import type { MetricKey } from "../../domain/metrics";
import { rng } from "../../domain/random";
import { analyzeSynthetic } from "./analyzer";
import type { ThrowParams } from "./synth";

export const demoPlayer: Player = {
  name: "森 海斗",
  number: 7,
  position: "QB",
  heightCm: 180,
  throws: "右投げ",
  team: "Tokyo Owls（架空）",
};

// ---- お手本（YouTube の架空データ） ----

type RefSeed = Omit<Reference, "reps"> & { params: Partial<ThrowParams>; gap: number; hss?: number };

const REF_SEEDS: RefSeed[] = [
  {
    id: "r1",
    title: "QB の 3 ステップドロップ完全解説",
    channel: "Spiral Lab",
    publishedAt: "2025-11-12",
    duration: "12:48",
    segment: { start: "4:10", end: "4:13" },
    creativeCommons: false,
    kind: "model",
    tags: ["ドロップ", "ステップ"],
    stats: { views: 820_000, likes: 31_000, subscribers: 410_000, trustedChannel: false, camera: "side", resolution: 1080, fps: 60, confidence: 0.93 },
    params: { stride: 1.06, elbowDrop: -0.02, tempo: 0.92, reach: 0.02, lean: 0.02, seed: 11 },
    gap: 0.04,
  },
  {
    id: "r2",
    title: "Hip-shoulder separation drill for QBs",
    channel: "Pocket Mechanics",
    publishedAt: "2026-02-03",
    duration: "9:21",
    segment: { start: "2:02", end: "2:05" },
    creativeCommons: false,
    kind: "drill",
    tags: ["回転", "捻り差"],
    stats: { views: 1_900_000, likes: 52_000, subscribers: 1_200_000, trustedChannel: false, camera: "behind", resolution: 1080, fps: 60, confidence: 0.91 },
    params: { stride: 1.0, seed: 12 },
    gap: 0.045,
    hss: 44,
  },
  {
    id: "r3",
    title: "ライン目印で覚えるステップ・アンド・スロー",
    channel: "Drop Back Academy",
    publishedAt: "2025-08-30",
    duration: "7:05",
    segment: { start: "2:14", end: "2:17" },
    creativeCommons: true,
    kind: "drill",
    tags: ["ステップ", "フットワーク"],
    stats: { views: 240_000, likes: 9_800, subscribers: 88_000, trustedChannel: false, camera: "side", resolution: 720, fps: 30, confidence: 0.88 },
    params: { stride: 0.96, elbowDrop: 0.01, tempo: 1.06, seed: 13 },
    gap: 0.038,
  },
  {
    id: "r4",
    title: "肘の高さを保つリリース練習",
    channel: "Gridiron Fundamentals JP",
    publishedAt: "2026-04-18",
    duration: "5:32",
    segment: { start: "1:05", end: "1:08" },
    creativeCommons: true,
    kind: "drill",
    tags: ["肘の高さ", "アームパス"],
    stats: { views: 96_000, likes: 4_100, subscribers: 35_000, trustedChannel: true, camera: "side", resolution: 1080, fps: 30, confidence: 0.92 },
    params: { stride: 1.02, elbowDrop: -0.03, tempo: 0.98, seed: 14 },
    gap: 0.042,
  },
  {
    id: "r5",
    title: "Kinematic sequence in elite passers",
    channel: "Throwing Science",
    publishedAt: "2026-06-09",
    duration: "14:10",
    segment: { start: "3:40", end: "3:43" },
    creativeCommons: false,
    kind: "model",
    tags: ["回転", "キネマティックシーケンス"],
    stats: { views: 3_400_000, likes: 71_000, subscribers: 2_200_000, trustedChannel: true, camera: "behind", resolution: 2160, fps: 60, confidence: 0.95 },
    params: { stride: 1.03, seed: 15 },
    gap: 0.048,
    hss: 47,
  },
  {
    id: "r6",
    title: "誰でも 60 ヤード飛ぶ！裏技スロー",
    channel: "Backyard QB",
    publishedAt: "2026-07-21",
    duration: "3:58",
    segment: { start: "0:42", end: "0:45" },
    creativeCommons: false,
    kind: "model",
    tags: ["遠投"],
    stats: { views: 6_100_000, likes: 98_000, subscribers: 900_000, trustedChannel: false, camera: "side", resolution: 720, fps: 30, confidence: 0.84 },
    params: { stride: 1.35, elbowDrop: 0.14, tempo: 0.85, reach: 0.06, lean: 0.08, confidence: 0.84, seed: 16 },
    gap: 0.01,
  },
  {
    id: "r7",
    title: "【基礎】ステップとリリースの連動",
    channel: "Coach Sato Passing Clinic",
    publishedAt: "2026-09-02",
    duration: "10:16",
    segment: { start: "5:30", end: "5:33" },
    creativeCommons: true,
    kind: "drill",
    tags: ["ステップ", "回転"],
    stats: { views: 18_000, likes: 1_100, subscribers: 6_000, trustedChannel: true, camera: "side", resolution: 1080, fps: 60, confidence: 0.96 },
    params: { stride: 0.99, elbowDrop: 0, tempo: 1.02, seed: 17, confidence: 0.96 },
    gap: 0.044,
  },
  {
    id: "r8",
    title: "Air raid quick game: base and footwork",
    channel: "Air Raid Drills",
    publishedAt: "2026-01-15",
    duration: "8:44",
    segment: { start: "6:01", end: "6:04" },
    creativeCommons: false,
    kind: "drill",
    tags: ["ベース", "フットワーク"],
    stats: { views: 450_000, likes: 12_000, subscribers: 150_000, trustedChannel: false, camera: "front", resolution: 1080, fps: 60, confidence: 0.9 },
    params: { stride: 1.01, seed: 18 },
    gap: 0.04,
    hss: 41,
  },
];

/** 1 本の動画の区間から取り込むレップ数 */
export const REPS_PER_REFERENCE = 3;

export const demoReferences: Reference[] = REF_SEEDS.map(({ params, gap, hss, ...r }, ri) => {
  const rand = rng(500 + ri);
  const n = (amp: number) => (rand() - 0.5) * 2 * amp;
  const reps = Array.from({ length: REPS_PER_REFERENCE }, (_, i) =>
    // 乱数を引く順番（params → gap → hss）を変えるとデータが変わるので注意
    analyzeSynthetic({
      id: `${r.id}-${i + 1}`,
      index: i,
      camera: r.stats.camera,
      params: {
        ...params,
        stride: (params.stride ?? 1) + n(0.06),
        elbowDrop: (params.elbowDrop ?? 0) + n(0.025),
        tempo: (params.tempo ?? 1) + n(0.08),
        reach: (params.reach ?? 0) + n(0.03),
        lean: (params.lean ?? 0) + n(0.03),
        bob: 0.004 + rand() * 0.008,
        seed: (params.seed ?? 1) * 10 + i,
      },
      gap: Math.max(0.005, gap + n(0.005)),
      hss: hss === undefined ? undefined : hss + n(3),
    }),
  );
  return { ...r, reps };
});

/** 改善点に紐付けるドリル動画 */
export const demoDrills: Partial<Record<MetricKey, { refId: string; label: string }>> = {
  strideRatio: { refId: "r3", label: "ライン目印のステップ・アンド・スロー" },
  frontKnee: { refId: "r7", label: "ステップとリリースの連動" },
  elbowHeight: { refId: "r4", label: "肘の高さを保つリリース練習" },
  elbowAngle: { refId: "r4", label: "肘の高さを保つリリース練習" },
  sequenceGap: { refId: "r5", label: "キネマティックシーケンスの解説" },
  releaseHeight: { refId: "r4", label: "肘の高さを保つリリース練習" },
};

// ---- 自分のセッション ----

type SessionSeed = Omit<Session, "reps"> & { base: Partial<ThrowParams>; gap: number; count: number };

const SESSION_SEEDS: SessionSeed[] = [
  { id: "s1", date: "2026-08-22", kind: "drill", camera: "side", title: "ドロップバック基礎", source: "local", base: { stride: 0.84, elbowDrop: 0.07, tempo: 1.08, lean: -0.02 }, gap: 0.016, count: 10 },
  { id: "s2", date: "2026-08-30", kind: "drill", camera: "side", title: "5 ステップ + ヒッチ", source: "local", base: { stride: 0.87, elbowDrop: 0.06, tempo: 1.05 }, gap: 0.022, count: 12 },
  { id: "s3", date: "2026-09-06", kind: "drill", camera: "side", title: "クイックゲーム", source: "local", base: { stride: 0.9, elbowDrop: 0.045, tempo: 1.03 }, gap: 0.028, count: 12 },
  { id: "s4", date: "2026-09-14", kind: "game", camera: "sideline", title: "秋季リーグ 第 2 節", source: "youtube", base: { stride: 0.92, elbowDrop: 0.04, tempo: 1.0 }, gap: 0.03, count: 8 },
  { id: "s5", date: "2026-09-23", kind: "drill", camera: "side", title: "ステップ幅の矯正", source: "local", base: { stride: 0.98, elbowDrop: 0.02, tempo: 0.97, reach: 0.01 }, gap: 0.038, count: 12 },
  { id: "s6", date: "2026-10-03", kind: "drill", camera: "side", title: "ドリル（横から）", source: "local", base: { stride: 0.9, elbowDrop: 0.045, tempo: 0.98 }, gap: 0.026, count: 12 },
];

/** 取り上げるレップ：最新セッションの Rep 4（ステップが狭く、肘が下がった例） */
export const DEMO_FOCUS = { session: "s6", index: 3 };
const FOCUS_SEED = { params: { stride: 0.85, elbowDrop: 0.06, tempo: 0.99, seed: 604 } as Partial<ThrowParams>, gap: 0.012 };

export const demoSessions: Session[] = SESSION_SEEDS.map(({ base, gap, count, ...s }, si) => {
  const rand = rng(100 + si);
  const n = (amp: number) => (rand() - 0.5) * 2 * amp;
  const rep = (i: number, params: Partial<ThrowParams>, g: number, camera: CameraAngle) => analyzeSynthetic({ id: `${s.id}-r${i + 1}`, index: i, params, camera, gap: g });
  const reps = Array.from({ length: count }, (_, i) => {
    if (s.id === DEMO_FOCUS.session && i === DEMO_FOCUS.index) return rep(i, FOCUS_SEED.params, FOCUS_SEED.gap, s.camera);
    return rep(
      i,
      {
        stride: (base.stride ?? 1) + n(0.04),
        elbowDrop: (base.elbowDrop ?? 0) + n(0.015),
        tempo: (base.tempo ?? 1) + n(0.03),
        reach: (base.reach ?? 0) + n(0.02),
        lean: (base.lean ?? 0) + n(0.015),
        seed: 1000 + si * 50 + i,
      },
      Math.max(0.005, gap + n(0.006)),
      s.camera,
    );
  });
  return { ...s, reps };
});
