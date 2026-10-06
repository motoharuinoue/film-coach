// 精度の評価：自分で撮った映像に手作業で付ける正解（関節の位置と、接地・リリースの瞬間）と、解析サービスが求めた誤差。
// 形は packages/schema の annotation.v1 / evaluation.v1 と同じ。誤差の計算は解析サービス（domain/evaluation.py）が行う。

import type { TrackBox } from "./footage";
import type { MetricKey } from "./metrics";
import type { ThrowHand } from "./throws";

/** 正解を付ける関節（付ける順）。目と耳は指標に使わず、横からはほとんど見分けられないので付けない */
export const LABEL_JOINTS = ["nose", "lShoulder", "rShoulder", "lElbow", "rElbow", "lWrist", "rWrist", "lHip", "rHip", "lKnee", "rKnee", "lAnkle", "rAnkle"] as const;
export type LabelJoint = (typeof LABEL_JOINTS)[number];

/** 元の映像のピクセル */
export type Point = [number, number];

export type FrameLabel = {
  frame: number;
  /** null は「見えない」。ない関節はまだ付けていない */
  points: Partial<Record<LabelJoint, Point | null>>;
};

export type ThrowLabel = {
  rep: number;
  /** 前足が地面に着いた最初のフレーム */
  plant: number | null;
  /** ボールが手から離れて見える最初のフレーム */
  release: number | null;
};

export type Annotation = { videoId: string; throws: ThrowLabel[]; frames: FrameLabel[]; updatedAt: string };
export type AnnotationInput = Pick<Annotation, "throws" | "frames">;

export type ErrorStats = { n: number; mean: number; median: number; p90: number; within: number[] };

export const JOINT_GROUPS = ["head", "shoulder", "elbow", "wrist", "hip", "knee", "ankle"] as const;
export type JointGroup = (typeof JOINT_GROUPS)[number];
export const GROUP_LABEL: Record<JointGroup, string> = { head: "頭（鼻）", shoulder: "肩", elbow: "肘", wrist: "手首", hip: "股関節", knee: "膝", ankle: "足首" };

export type EventKey = "plant" | "release";
export const EVENT_LABEL: Record<EventKey, string> = { plant: "接地", release: "リリース" };
export const EVENT_HINT: Record<EventKey, string> = {
  plant: "前足が地面に着いた最初のフレーム",
  release: "ボールが手から離れて見える最初のフレーム",
};

/** 1 フレームで測る指標（正解の骨格から手で測れるもの） */
export const EVALUATED_METRICS: MetricKey[] = ["strideRatio", "frontKnee", "elbowHeight", "elbowAngle", "releaseHeight", "trunkTilt"];

export type EvaluationThrow = {
  rep: number;
  start: number;
  end: number;
  /** 解析で見つけた接地・リリース（映像のフレーム番号）。正解を付けるときは見せない */
  plant: number;
  release: number;
  /** 関節の正解を付けるフレーム（区間の 25・50・75% と、正解の接地・リリース） */
  frames: number[];
};

export type EvaluationTarget = {
  video: { id: string; name: string; fps: number; width: number; height: number; frameCount: number };
  hand: ThrowHand;
  throws: EvaluationThrow[];
  annotation: Annotation | null;
};

type RawFinal = { raw: ErrorStats | null; final: ErrorStats | null };

export type EvaluationReport = {
  videos: number;
  throws: number;
  frames: number;
  joints: RawFinal;
  groups: Record<JointGroup, RawFinal>;
  /** 瞬間の差（ミリ秒） */
  events: Record<EventKey, ErrorStats | null>;
  /** total：解析の値と手で測った値の差。pose：解析の骨格を正解の瞬間で測った値との差（骨格の誤差による分） */
  metrics: Partial<Record<MetricKey, { total: ErrorStats | null; pose: ErrorStats | null }>>;
  details: {
    /** finalDxCm・finalDyCm は、指標に使う骨格の点の正解から見た向き（前・上が正）。部位ごとの平均が、点の付け方の違い（かたより） */
    joints: { videoId: string; frame: number; joint: LabelJoint; rawCm: number | null; finalCm: number; finalDxCm: number; finalDyCm: number }[];
    events: { videoId: string; rep: number; event: EventKey; label: number; found: number; frames: number; ms: number }[];
    metrics: { videoId: string; rep: number; metric: MetricKey; labeled: number; analyzed: number | null; analyzedAtLabel: number | null; uncertainty: number | null }[];
  };
};

export type Evaluation = { joints: LabelJoint[]; thresholdsCm: number[]; targets: EvaluationTarget[]; report: EvaluationReport };

/**
 * 正解を付けるときの関節の呼び名。左右の取り違えを防ぐため、投げる腕の側か・前足の側かで示し、左右を添える。
 * 前足は、投げる腕と反対の側（右投げなら左足）
 */
export function jointLabel(joint: LabelJoint, hand: ThrowHand): string {
  if (joint === "nose") return "頭（鼻）";
  const side = joint[0] === "l" ? "左" : "右";
  const throwing = (joint[0] === "r") === (hand === "right");
  const part = joint.slice(1);
  const name = { Shoulder: "肩", Elbow: "肘", Wrist: "手首", Hip: "股関節", Knee: "膝", Ankle: "足首" }[part]!;
  if (part === "Shoulder" || part === "Elbow" || part === "Wrist") return `${throwing ? "投げる腕" : "反対の腕"}の${name}（${side}）`;
  return `${throwing ? "後ろ足" : "前足"}の${name}（${side}）`;
}

/** 投げる腕の側・後ろ足の側か（点の色分けに使う） */
export function isThrowingSide(joint: LabelJoint, hand: ThrowHand) {
  return joint !== "nose" && (joint[0] === "r") === (hand === "right");
}

export const GROUP_OF: Record<LabelJoint, JointGroup> = {
  nose: "head",
  lShoulder: "shoulder",
  rShoulder: "shoulder",
  lElbow: "elbow",
  rElbow: "elbow",
  lWrist: "wrist",
  rWrist: "wrist",
  lHip: "hip",
  rHip: "hip",
  lKnee: "knee",
  rKnee: "knee",
  lAnkle: "ankle",
  rAnkle: "ankle",
};

/** 誤差（絶対値）の要約（解析サービスの error_stats と同じ求め方） */
export function errorStats(errors: number[], thresholds: number[] = []): ErrorStats | null {
  if (!errors.length) return null;
  const xs = errors.map(Math.abs).sort((a, b) => a - b);
  const mid = xs.length / 2;
  const median = xs.length % 2 ? xs[Math.floor(mid)]! : (xs[mid - 1]! + xs[mid]!) / 2;
  const p90 = xs[Math.min(xs.length - 1, Math.ceil(0.9 * xs.length) - 1)]!;
  return { n: xs.length, mean: xs.reduce((a, x) => a + x, 0) / xs.length, median, p90, within: thresholds.map((t) => xs.filter((x) => x <= t).length / xs.length) };
}

/** 部位ごとの、指標に使う骨格の点のかたより（正解から見た向きの平均、cm） */
export function biasOf(joints: EvaluationReport["details"]["joints"], group: JointGroup): { forward: number; up: number } | undefined {
  const es = joints.filter((e) => GROUP_OF[e.joint] === group);
  if (!es.length) return undefined;
  return { forward: es.reduce((a, e) => a + e.finalDxCm, 0) / es.length, up: es.reduce((a, e) => a + e.finalDyCm, 0) / es.length };
}

export const isFrameDone = (f: FrameLabel | undefined) => !!f && LABEL_JOINTS.every((j) => j in f.points);

/** まだ付けていない最初の関節 */
export const nextJoint = (f: FrameLabel | undefined): LabelJoint | undefined => LABEL_JOINTS.find((j) => !f || !(j in f.points));

export function frameLabel(a: AnnotationInput, frame: number): FrameLabel | undefined {
  return a.frames.find((f) => f.frame === frame);
}

/** 1 つの関節の正解を置き換えた正解（フレームがなければ足す） */
export function withPoint(a: AnnotationInput, frame: number, joint: LabelJoint, p: Point | null): AnnotationInput {
  const current = frameLabel(a, frame);
  const next: FrameLabel = { frame, points: { ...current?.points, [joint]: p } };
  const frames = current ? a.frames.map((f) => (f.frame === frame ? next : f)) : [...a.frames, next].sort((x, y) => x.frame - y.frame);
  return { ...a, frames };
}

/** 1 つの関節の正解を消した正解 */
export function withoutPoint(a: AnnotationInput, frame: number, joint: LabelJoint): AnnotationInput {
  return {
    ...a,
    frames: a.frames.map((f) => {
      if (f.frame !== frame) return f;
      const { [joint]: _removed, ...rest } = f.points;
      return { ...f, points: rest };
    }),
  };
}

/** 投球の瞬間の正解を置き換えた正解 */
export function withEvent(a: AnnotationInput, rep: number, key: EventKey, frame: number | null): AnnotationInput {
  const current = a.throws.find((t) => t.rep === rep) ?? { rep, plant: null, release: null };
  const next = { ...current, [key]: frame };
  const throws = a.throws.some((t) => t.rep === rep) ? a.throws.map((t) => (t.rep === rep ? next : t)) : [...a.throws, next];
  return { ...a, throws };
}

/** 映像ごとの進み具合：瞬間を付けた投球の数と、すべての関節を付けたフレームの数 */
export function progressOf(t: EvaluationTarget, a: AnnotationInput) {
  const events = t.throws.filter((x) => {
    const l = a.throws.find((y) => y.rep === x.rep);
    return l?.plant != null && l?.release != null;
  }).length;
  const frames = t.throws.flatMap((x) => x.frames);
  const done = frames.filter((f) => isFrameDone(frameLabel(a, f))).length;
  return { events, eventsTotal: t.throws.length, frames: done, framesTotal: frames.length };
}

/** 正解を付けるときに拡大して見せる範囲（元の映像のピクセル） */
export type Crop = { x: number; y: number; w: number; h: number };

const CROP_MARGIN = 1.4;

/**
 * 拡大して見せる範囲：投球の区間（lo〜hi）で最も大きい人の枠の 1.4 倍の正方形を、そのフレームの人の枠の中心に置く。
 * 大きさを区間で固定するので、コマ送りしても拡大率は変わらない。枠がなければ映像全体
 */
export function cropFor(boxes: Map<number, TrackBox>, frame: number, lo: number, hi: number, width: number, height: number): Crop {
  const full = { x: 0, y: 0, w: width, h: height };
  let size = 0;
  for (let i = lo; i <= hi; i++) {
    const b = boxes.get(i);
    if (b) size = Math.max(size, b.x2 - b.x1, b.y2 - b.y1);
  }
  // 枠のあるいちばん近いフレーム
  let box: TrackBox | undefined;
  for (let d = 0; d <= hi - lo && !box; d++) box = boxes.get(frame - d) ?? boxes.get(frame + d);
  if (!box || size <= 0) return full;
  const side = Math.min(width, height, size * CROP_MARGIN);
  const clamp = (v: number, max: number) => Math.min(Math.max(0, v), max);
  return { x: clamp((box.x1 + box.x2) / 2 - side / 2, width - side), y: clamp((box.y1 + box.y2) / 2 - side / 2, height - side), w: side, h: side };
}
