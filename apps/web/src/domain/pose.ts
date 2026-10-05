// 骨格データの型。関節の並びは COCO-17（RTMPose の出力と同じ）に合わせる。
// 座標はワールド 2D（メートル、x は投げる方向、y は上向き、地面が 0）。

export const KP = {
  nose: 0,
  lEye: 1,
  rEye: 2,
  lEar: 3,
  rEar: 4,
  lShoulder: 5,
  rShoulder: 6,
  lElbow: 7,
  rElbow: 8,
  lWrist: 9,
  rWrist: 10,
  lHip: 11,
  rHip: 12,
  lKnee: 13,
  rKnee: 14,
  lAnkle: 15,
  rAnkle: 16,
} as const;

export type KeypointName = keyof typeof KP;

export type Vec2 = { x: number; y: number };
export type Keypoint = Vec2 & { c: number };
export type PoseFrame = { t: number; kp: Keypoint[] };

export type PoseSequence = {
  fps: number;
  heightM: number;
  frames: PoseFrame[];
};

// 描画用の骨。side は手前（投げる腕側）か奥かで線の濃さを変えるために使う
export const BONES: { a: number; b: number; side: "near" | "far" | "center" }[] = [
  { a: KP.lShoulder, b: KP.rShoulder, side: "center" },
  { a: KP.lHip, b: KP.rHip, side: "center" },
  { a: KP.rShoulder, b: KP.rHip, side: "near" },
  { a: KP.lShoulder, b: KP.lHip, side: "far" },
  { a: KP.rShoulder, b: KP.rElbow, side: "near" },
  { a: KP.rElbow, b: KP.rWrist, side: "near" },
  { a: KP.lShoulder, b: KP.lElbow, side: "far" },
  { a: KP.lElbow, b: KP.lWrist, side: "far" },
  { a: KP.rHip, b: KP.rKnee, side: "near" },
  { a: KP.rKnee, b: KP.rAnkle, side: "near" },
  { a: KP.lHip, b: KP.lKnee, side: "far" },
  { a: KP.lKnee, b: KP.lAnkle, side: "far" },
];

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

/** 3 点 a-b-c の b における角度（度） */
export function jointAngle(a: Vec2, b: Vec2, c: Vec2): number {
  const u = sub(a, b);
  const v = sub(c, b);
  const cos = (u.x * v.x + u.y * v.y) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y));
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}

export function kp(frame: PoseFrame, name: KeypointName): Keypoint {
  const p = frame.kp[KP[name]];
  if (!p) throw new Error(`keypoint ${name} missing`);
  return p;
}

/** 頭の中心（鼻と両耳の平均）。描画の円の中心に使う */
export function headCenter(frame: PoseFrame): Vec2 {
  const n = kp(frame, "nose");
  const l = kp(frame, "lEar");
  const r = kp(frame, "rEar");
  return { x: (n.x + l.x + r.x) / 3, y: (n.y + l.y + r.y) / 3 };
}

/** 関節の速さ（m/s）を中心差分で求める */
export function speedSeries(seq: PoseSequence, name: KeypointName): number[] {
  const { frames, fps } = seq;
  return frames.map((_, i) => {
    const prev = frames[Math.max(0, i - 1)];
    const next = frames[Math.min(frames.length - 1, i + 1)];
    if (!prev || !next || prev === next) return 0;
    const dt = (Math.min(frames.length - 1, i + 1) - Math.max(0, i - 1)) / fps;
    return dist(kp(next, name), kp(prev, name)) / dt;
  });
}

export function pelvisSeries(seq: PoseSequence): Vec2[] {
  return seq.frames.map((f) => mid(kp(f, "lHip"), kp(f, "rHip")));
}

/**
 * 関節ごとの移動平均で平滑化する（信頼度で重み付け）。
 * M1 では One Euro / Savitzky-Golay に置き換える。
 */
export function smoothSequence(seq: PoseSequence, radius = 2): PoseSequence {
  const { frames } = seq;
  const out = frames.map((f, i) => ({
    t: f.t,
    kp: f.kp.map((p, j) => {
      let sx = 0;
      let sy = 0;
      let sw = 0;
      for (let k = Math.max(0, i - radius); k <= Math.min(frames.length - 1, i + radius); k++) {
        const q = frames[k]!.kp[j]!;
        sx += q.x * q.c;
        sy += q.y * q.c;
        sw += q.c;
      }
      return { x: sx / sw, y: sy / sw, c: p.c };
    }),
  }));
  return { ...seq, frames: out };
}
