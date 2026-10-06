// QB 指標の定義と計算。指標の日本語名はユビキタス言語としてドメインに置く。

import { CAMERA_LABEL, type CameraAngle } from "./camera";
import { strideFound, strideSeen, type Events } from "./phases";
import { headCenter, jointAngle, kp, mid, type PoseSequence } from "./pose";

export type MetricKey =
  | "releaseTime"
  | "strideRatio"
  | "frontKnee"
  | "hipShoulderSep"
  | "sequenceGap"
  | "elbowHeight"
  | "elbowAngle"
  | "releaseHeight"
  | "trunkTilt"
  | "headStability";

/** レーダーチャートの観点。改善点は同じ観点から 1 つだけ選ぶ */
export type RadarAxis = "footwork" | "base" | "rotation" | "armPath" | "release" | "posture" | "consistency";

export const RADAR_LABEL: Record<RadarAxis, string> = {
  footwork: "フットワーク",
  base: "ベース",
  rotation: "回転",
  armPath: "アームパス",
  release: "リリース",
  posture: "姿勢",
  consistency: "一貫性",
};

export type MetricDef = {
  key: MetricKey;
  label: string;
  short: string;
  unit: string;
  digits: number;
  validAngles: CameraAngle[];
  axis: RadarAxis;
  /** 判定の根拠にするフレーム */
  at: keyof Events | "range";
  hint: string;
  /** 投げ始め（ドロップの有無）で値の意味が変わる指標。投げ始めが同じお手本とだけ比べる */
  byApproach?: true;
};

const ALL: CameraAngle[] = ["side", "behind", "front", "endzone", "sideline"];

export const METRICS: MetricDef[] = [
  { key: "releaseTime", label: "始動からリリース", short: "リリース時間", unit: "s", digits: 2, validAngles: ALL, axis: "release", at: "release", hint: "ステップ開始からボールが離れるまで" },
  { key: "strideRatio", label: "ステップ幅（身長比）", short: "ステップ幅", unit: "", digits: 2, validAngles: ["side"], axis: "footwork", at: "plant", hint: "前足の接地時の両足首の距離 ÷ 身長" },
  { key: "frontKnee", label: "接地時の前膝角度", short: "前膝角度", unit: "°", digits: 0, validAngles: ["side"], axis: "footwork", at: "plant", hint: "ブロックの強さ。伸びすぎも曲がりすぎも力が逃げる" },
  { key: "hipShoulderSep", label: "腰と肩の捻り差", short: "捻り差", unit: "°", digits: 0, validAngles: ["behind", "front"], axis: "rotation", at: "plant", hint: "接地時の骨盤と肩のラインの角度差の最大値" },
  { key: "sequenceGap", label: "骨盤→体幹のピーク間隔", short: "回転の間", unit: "ms", digits: 0, validAngles: ["side", "behind"], axis: "rotation", at: "release", hint: "キネマティックシーケンス。骨盤が先に回り、体幹が続くのが理想" },
  { key: "elbowHeight", label: "リリース時の肘の高さ", short: "肘の高さ", unit: "cm", digits: 0, validAngles: ["side", "behind"], axis: "armPath", at: "release", hint: "肩のラインからの高さ。マイナスは肩より下" },
  { key: "elbowAngle", label: "リリース時の肘角度", short: "肘角度", unit: "°", digits: 0, validAngles: ["side"], axis: "armPath", at: "release", hint: "肩・肘・手首の角度" },
  { key: "releaseHeight", label: "リリース点の高さ（身長比）", short: "リリース高", unit: "", digits: 2, validAngles: ["side"], axis: "release", at: "release", hint: "手首の高さ ÷ 身長" },
  { key: "trunkTilt", label: "リリース時の体幹の前傾", short: "前傾", unit: "°", digits: 0, validAngles: ["side"], axis: "posture", at: "release", hint: "腰から肩のラインと鉛直線の角度" },
  { key: "headStability", label: "頭の上下動", short: "頭の安定", unit: "cm", digits: 1, validAngles: ALL, axis: "base", at: "range", hint: "ドロップとセットの間の頭の高さの標準偏差", byApproach: true },
];

export const METRIC_BY_KEY = Object.fromEntries(METRICS.map((m) => [m.key, m])) as Record<MetricKey, MetricDef>;

export type MetricValues = Partial<Record<MetricKey, number>>;

/** 頭の上下動を測るのに要る、ステップの前に映っている長さ（秒）。短いと、標準偏差が意味を持たない */
export const MIN_SET_S = 0.3;

export type AnalysisExtras = {
  /** 後方・正面の映像でのみ測れる値 */
  hipShoulderSep?: number;
  /** 骨盤→体幹のピーク間隔（秒） */
  sequenceGapS?: number;
};

export function computeMetrics(seq: PoseSequence, e: Events, extras: AnalysisExtras = {}): MetricValues {
  const f = (i: number) => seq.frames[i]!;
  const plant = f(e.plant);
  const rel = f(e.release);
  const h = seq.heightM;

  const shoulderMid = mid(kp(rel, "lShoulder"), kp(rel, "rShoulder"));
  const hipMid = mid(kp(rel, "lHip"), kp(rel, "rHip"));
  const tilt = (Math.atan2(shoulderMid.x - hipMid.x, shoulderMid.y - hipMid.y) * 180) / Math.PI;

  // 映っていない区間・見つからなかったイベントからは測らない
  const found = strideFound(e);
  let headStability: number | undefined;
  if (found && e.strideStart >= Math.max(1, Math.round(MIN_SET_S * seq.fps))) {
    const heads = seq.frames.slice(0, e.strideStart).map((fr) => headCenter(fr).y);
    const mean = heads.reduce((a, b) => a + b, 0) / heads.length;
    headStability = Math.sqrt(heads.reduce((a, b) => a + (b - mean) ** 2, 0) / heads.length) * 100;
  }

  return {
    releaseTime: strideSeen(e) ? (e.release - e.strideStart) / seq.fps : undefined,
    strideRatio: found ? Math.abs(kp(plant, "lAnkle").x - kp(plant, "rAnkle").x) / h : undefined,
    frontKnee: found ? jointAngle(kp(plant, "lHip"), kp(plant, "lKnee"), kp(plant, "lAnkle")) : undefined,
    hipShoulderSep: extras.hipShoulderSep,
    sequenceGap: extras.sequenceGapS !== undefined ? extras.sequenceGapS * 1000 : undefined,
    elbowHeight: (kp(rel, "rElbow").y - kp(rel, "rShoulder").y) * 100,
    elbowAngle: jointAngle(kp(rel, "rShoulder"), kp(rel, "rElbow"), kp(rel, "rWrist")),
    releaseHeight: kp(rel, "rWrist").y / h,
    trunkTilt: tilt,
    headStability,
  };
}

/** カメラ角度でその指標を判定できるか */
export function isValidFor(def: MetricDef, angle: CameraAngle) {
  return def.validAngles.includes(angle);
}

/** カメラ角度で測れない指標を捨てる */
export function onlyValid(values: MetricValues, angle: CameraAngle): MetricValues {
  const out: MetricValues = {};
  for (const def of METRICS) if (isValidFor(def, angle) && values[def.key] !== undefined) out[def.key] = values[def.key];
  return out;
}

export function invalidReason(def: MetricDef, angle: CameraAngle) {
  const ok = def.validAngles.map((a) => CAMERA_LABEL[a]).join("・");
  return `${CAMERA_LABEL[angle]}の映像では測れません（${ok}の映像が必要）`;
}

export function formatMetric(key: MetricKey, value: number | undefined) {
  if (value === undefined) return "—";
  const def = METRIC_BY_KEY[key];
  const v = value.toFixed(def.digits);
  return def.unit ? `${v} ${def.unit}` : v;
}
