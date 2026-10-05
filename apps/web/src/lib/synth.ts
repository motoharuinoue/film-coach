// デモ用の合成データ：右投げ QB を横から撮った投球動作を、キーフレームの補間で作る。
// M1 で Python の骨格推定に置き換えるまでの代役。出力は実データと同じ PoseSequence の形。

import type { Keypoint, PoseFrame, PoseSequence } from "./pose";

type J = [number, number];
type Body = {
  head: J;
  shR: J;
  shL: J;
  elR: J;
  elL: J;
  wrR: J;
  wrL: J;
  hipR: J;
  hipL: J;
  knR: J;
  knL: J;
  anR: J;
  anL: J;
};
type JointName = keyof Body;
const JOINTS: JointName[] = ["head", "shR", "shL", "elR", "elL", "wrR", "wrL", "hipR", "hipL", "knR", "knL", "anR", "anL"];

export type ThrowParams = {
  /** ステップ幅の倍率（1 が基準） */
  stride: number;
  /** リリース時に肘が下がる量（m） */
  elbowDrop: number;
  /** セット以降の動作の速さ（1 が基準、小さいほど速い） */
  tempo: number;
  /** リリース時の腕の前方への伸び（m） */
  reach: number;
  /** 体幹の前傾の追加量（m、肩を前に出す） */
  lean: number;
  /** ドロップ中の上半身の上下動（m） */
  bob: number;
  /** 関節検出の信頼度の平均 */
  confidence: number;
  /** 乱数のシード（関節のわずかな揺れ） */
  seed: number;
};

export const DEFAULT_PARAMS: ThrowParams = {
  stride: 1,
  elbowDrop: 0,
  tempo: 1,
  reach: 0,
  lean: 0,
  bob: 0.008,
  confidence: 0.93,
  seed: 1,
};

const UPPER_READY = ["head", "shR", "shL", "elR", "elL", "wrR", "wrL", "hipR", "hipL"] as const;

/** ドロップ中の構え。px は骨盤の x、lift で浮かせる足を選ぶ */
function ready(px: number, lift?: "R" | "L", bob = 0): Body {
  const b: Body = {
    head: [px + 0.12, 1.66],
    shR: [px + 0.06, 1.44],
    shL: [px + 0.1, 1.44],
    elR: [px + 0.16, 1.16],
    elL: [px + 0.22, 1.18],
    wrR: [px + 0.3, 1.28],
    wrL: [px + 0.32, 1.3],
    hipR: [px - 0.02, 0.93],
    hipL: [px + 0.02, 0.93],
    knR: [px + 0.06, 0.52],
    knL: [px + 0.1, 0.52],
    anR: [px - 0.04, 0.08],
    anL: [px + 0.04, 0.08],
  };
  if (bob) shift(b, [...UPPER_READY], 0, bob);
  if (lift === "R") {
    b.anR = [px - 0.28, 0.24];
    b.knR = [px - 0.06, 0.56];
  }
  if (lift === "L") {
    b.anL = [px - 0.22, 0.22];
    b.knL = [px + 0.02, 0.56];
  }
  return b;
}

const SET: Body = {
  head: [-1.27, 1.65],
  shR: [-1.36, 1.42],
  shL: [-1.28, 1.43],
  elR: [-1.25, 1.16],
  elL: [-1.18, 1.18],
  wrR: [-1.13, 1.3],
  wrL: [-1.11, 1.32],
  hipR: [-1.4, 0.9],
  hipL: [-1.32, 0.9],
  knR: [-1.52, 0.5],
  knL: [-1.15, 0.5],
  anR: [-1.66, 0.08],
  anL: [-1.07, 0.08],
};

const LOAD: Body = {
  head: [-1.3, 1.65],
  shR: [-1.42, 1.42],
  shL: [-1.26, 1.44],
  elR: [-1.62, 1.42],
  elL: [-1.12, 1.36],
  wrR: [-1.62, 1.68],
  wrL: [-0.98, 1.42],
  hipR: [-1.38, 0.88],
  hipL: [-1.3, 0.89],
  knR: [-1.5, 0.48],
  knL: [-1.02, 0.58],
  anR: [-1.66, 0.08],
  anL: [-0.95, 0.22],
};

const PLANT: Body = {
  head: [-1.18, 1.66],
  shR: [-1.36, 1.43],
  shL: [-1.12, 1.42],
  elR: [-1.56, 1.48],
  elL: [-0.98, 1.3],
  wrR: [-1.5, 1.74],
  wrL: [-1.02, 1.2],
  hipR: [-1.3, 0.88],
  hipL: [-1.2, 0.89],
  knR: [-1.52, 0.46],
  knL: [-0.86, 0.5],
  anR: [-1.66, 0.1],
  anL: [-0.72, 0.08],
};

// 腕の加速：肘が先行し、手首は頭の後ろの高い位置
const ACCEL: Body = {
  head: [-1.06, 1.65],
  shR: [-1.18, 1.44],
  shL: [-1.12, 1.41],
  elR: [-1.0, 1.68],
  elL: [-1.08, 1.18],
  wrR: [-1.05, 1.96],
  wrL: [-1.12, 1.08],
  hipR: [-1.24, 0.88],
  hipL: [-1.14, 0.89],
  knR: [-1.48, 0.45],
  knL: [-0.84, 0.5],
  anR: [-1.66, 0.12],
  anL: [-0.72, 0.08],
};

const RELEASE: Body = {
  head: [-0.98, 1.64],
  shR: [-1.02, 1.44],
  shL: [-1.1, 1.4],
  elR: [-0.84, 1.52],
  elL: [-1.16, 1.12],
  wrR: [-0.74, 1.78],
  wrL: [-1.18, 1.0],
  hipR: [-1.18, 0.88],
  hipL: [-1.08, 0.89],
  knR: [-1.44, 0.44],
  knL: [-0.82, 0.5],
  anR: [-1.62, 0.16],
  anL: [-0.72, 0.08],
};

// リリース直後：腕は前に振り抜かれる途中
const THRU: Body = {
  head: [-0.92, 1.63],
  shR: [-0.92, 1.44],
  shL: [-1.04, 1.39],
  elR: [-0.64, 1.6],
  elL: [-1.18, 1.06],
  wrR: [-0.37, 1.55],
  wrL: [-1.18, 0.98],
  hipR: [-1.12, 0.88],
  hipL: [-1.04, 0.89],
  knR: [-1.38, 0.44],
  knL: [-0.8, 0.5],
  anR: [-1.56, 0.18],
  anL: [-0.72, 0.08],
};

const FOLLOW: Body = {
  head: [-0.8, 1.58],
  shR: [-0.86, 1.4],
  shL: [-0.96, 1.38],
  elR: [-0.72, 1.18],
  elL: [-1.06, 1.14],
  wrR: [-0.84, 0.98],
  wrL: [-1.1, 0.98],
  hipR: [-1.0, 0.9],
  hipL: [-0.94, 0.9],
  knR: [-0.96, 0.55],
  knL: [-0.78, 0.5],
  anR: [-0.92, 0.24],
  anL: [-0.72, 0.08],
};

const FINISH: Body = {
  head: [-0.66, 1.62],
  shR: [-0.74, 1.42],
  shL: [-0.82, 1.41],
  elR: [-0.66, 1.16],
  elL: [-0.9, 1.15],
  wrR: [-0.76, 1.0],
  wrL: [-0.94, 1.02],
  hipR: [-0.82, 0.92],
  hipL: [-0.78, 0.92],
  knR: [-0.7, 0.52],
  knL: [-0.72, 0.5],
  anR: [-0.7, 0.08],
  anL: [-0.72, 0.08],
};

const clone = (b: Body): Body => Object.fromEntries(JOINTS.map((k) => [k, [...b[k]] as J])) as Body;

function shift(b: Body, joints: JointName[], dx: number, dy = 0) {
  for (const j of joints) {
    b[j][0] += dx;
    b[j][1] += dy;
  }
}

const UPPER: JointName[] = ["head", "shR", "shL", "elR", "elL", "wrR", "wrL"];
const HIPS: JointName[] = ["hipR", "hipL"];

/** パラメータを反映したキーフレームの列（時刻と姿勢） */
function keyframes(p: ThrowParams): [number, Body][] {
  const baseStride = PLANT.anL[0] - PLANT.anR[0];
  const dStride = (p.stride - 1) * baseStride;
  const withStride = (src: Body) => {
    const b = clone(src);
    shift(b, ["anL", "knL"], dStride);
    shift(b, [...HIPS, ...UPPER], dStride * 0.5);
    return b;
  };
  const plant = withStride(PLANT);
  const arm = (src: Body, reach: number, lean: number) => {
    const b = withStride(src);
    shift(b, ["elR"], reach * 0.6, -p.elbowDrop);
    shift(b, ["wrR"], reach, -p.elbowDrop * 0.6);
    shift(b, ["head", "shR", "shL"], lean);
    return b;
  };
  const accel = arm(ACCEL, 0, p.lean * 0.5);
  const release = arm(RELEASE, p.reach, p.lean);
  const thru = arm(THRU, p.reach, p.lean);
  const follow = withStride(FOLLOW);
  shift(follow, ["head", "shR", "shL"], p.lean * 0.8);
  const finish = withStride(FINISH);

  const T = (t: number) => (t <= 0.56 ? t : 0.56 + (t - 0.56) * p.tempo);
  return [
    [0, ready(0)],
    [0.12, ready(-0.3, "R", p.bob)],
    [0.24, ready(-0.62, "L", -p.bob)],
    [0.36, ready(-0.95, "R", p.bob)],
    [0.47, ready(-1.22, "L", -p.bob * 0.5)],
    [T(0.56), SET],
    [T(0.8), (() => {
      const b = clone(SET);
      shift(b, UPPER, 0, -0.01);
      return b;
    })()],
    [T(0.92), LOAD],
    [T(1.06), plant],
    [T(1.12), accel],
    [T(1.16), release],
    [T(1.21), thru],
    [T(1.4), follow],
    [T(1.62), finish],
  ];
}

/** 時刻に対する 3 次エルミート補間（接線は前後のキーフレームの差分） */
function sample(frames: [number, Body][], t: number): Body {
  const n = frames.length;
  const first = frames[0]!;
  const last = frames[n - 1]!;
  if (t <= first[0]) return clone(first[1]);
  if (t >= last[0]) return clone(last[1]);
  let i = 0;
  while (i < n - 2 && t > frames[i + 1]![0]) i++;
  const [t0, b0] = frames[i]!;
  const [t1, b1] = frames[i + 1]!;
  const prev = frames[i - 1];
  const next = frames[i + 2];
  const h = t1 - t0;
  const u = (t - t0) / h;
  const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
  const h10 = u ** 3 - 2 * u ** 2 + u;
  const h01 = -2 * u ** 3 + 3 * u ** 2;
  const h11 = u ** 3 - u ** 2;
  const out = clone(b0);
  for (const j of JOINTS) {
    for (const d of [0, 1] as const) {
      const m0 = prev ? (b1[j][d] - prev[1][j][d]) / (t1 - prev[0]) : 0;
      const m1 = next ? (next[1][j][d] - b0[j][d]) / (next[0] - t0) : 0;
      out[j][d] = h00 * b0[j][d] + h10 * h * m0 + h01 * b1[j][d] + h11 * h * m1;
    }
  }
  return out;
}

/** シード付きの擬似乱数（mulberry32） */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOISE_M = 0.004;

function toKeypoints(b: Body, conf: number, rand: () => number): Keypoint[] {
  const n = () => (rand() + rand() + rand() - 1.5) * 2 * NOISE_M;
  const k = (j: J, dx = 0, dy = 0): Keypoint => ({
    x: j[0] + dx + n(),
    y: j[1] + dy + n(),
    c: Math.min(0.99, Math.max(0.3, conf + (rand() - 0.5) * 0.08)),
  });
  const h = b.head;
  // COCO-17 の並び。顔の点は頭の中心から作る（右向き）
  return [
    k(h, 0.07, -0.01),
    k(h, 0.05, 0.025),
    k(h, 0.055, 0.02),
    k(h, -0.03, 0.005),
    k(h, -0.02, 0.0),
    k(b.shL),
    k(b.shR),
    k(b.elL),
    k(b.elR),
    k(b.wrL),
    k(b.wrR),
    k(b.hipL),
    k(b.hipR),
    k(b.knL),
    k(b.knR),
    k(b.anL),
    k(b.anR),
  ];
}

export function synthesizeThrow(params: Partial<ThrowParams> = {}, fps = 60): PoseSequence {
  const p = { ...DEFAULT_PARAMS, ...params };
  const kfs = keyframes(p);
  const end = kfs[kfs.length - 1]![0] + 0.08;
  const rand = rng(p.seed);
  const frames: PoseFrame[] = [];
  for (let i = 0; i * (1 / fps) <= end; i++) {
    const t = i / fps;
    frames.push({ t, kp: toKeypoints(sample(kfs, t), p.confidence, rand) });
  }
  return { fps, heightM: 1.8, frames };
}

/**
 * 骨盤・体幹・腕の回転速度（度/秒）。横からの 2D では回転を直接測れないので、
 * デモでは各部位のピーク時刻（リリース基準の秒）から曲線を作る。M5 の 3D 化で実測に置き換える。
 */
export type SequenceTiming = { pelvis: number; trunk: number; arm: number };

export function rotationVelocity(seq: PoseSequence, releaseT: number, timing: SequenceTiming) {
  const parts = [
    { key: "pelvis" as const, peak: 620, width: 0.075 },
    { key: "trunk" as const, peak: 910, width: 0.06 },
    { key: "arm" as const, peak: 1480, width: 0.045 },
  ];
  return parts.map((part) => ({
    key: part.key,
    peakT: releaseT + timing[part.key],
    values: seq.frames.map((f) => part.peak * Math.exp(-(((f.t - (releaseT + timing[part.key])) / part.width) ** 2))),
  }));
}
