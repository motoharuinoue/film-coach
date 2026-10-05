// フェーズ分割と QB 指標の計算。M1 で Python（services/analyzer）に移す処理の TypeScript 版。

import { dist, headCenter, jointAngle, kp, mid, pelvisSeries, speedSeries, type PoseSequence } from "./pose";

export type CameraAngle = "side" | "behind" | "front" | "endzone" | "sideline";

export const CAMERA_LABEL: Record<CameraAngle, string> = {
  side: "横から",
  behind: "後方から",
  front: "正面から",
  endzone: "エンドゾーン",
  sideline: "サイドライン",
};

export type PhaseKey = "drop" | "set" | "stride" | "release" | "follow";

export const PHASE_LABEL: Record<PhaseKey, string> = {
  drop: "ドロップ",
  set: "セット",
  stride: "ステップ",
  release: "リリース",
  follow: "フォロー",
};

export type Phase = { key: PhaseKey; start: number; end: number };

export type Events = {
  setStart: number;
  strideStart: number;
  plant: number;
  release: number;
  followStart: number;
  last: number;
};

/** ルールベースのフェーズ分割。戻り値はフレーム番号 */
export function detectEvents(seq: PoseSequence): Events {
  const { fps, frames } = seq;
  const last = frames.length - 1;
  const pelvis = pelvisSeries(seq);
  const pelvisSpeed = pelvis.map((_, i) => {
    const a = Math.max(0, i - 1);
    const b = Math.min(last, i + 1);
    return b === a ? 0 : (dist(pelvis[b]!, pelvis[a]!) * fps) / (b - a);
  });
  const ankleL = frames.map((f) => kp(f, "lAnkle"));
  const ankleLSpeed = speedSeries(seq, "lAnkle");
  const wristSpeed = speedSeries(seq, "rWrist");

  const minDrop = Math.round(0.25 * fps);
  // セット：ドロップで動いた骨盤が止まる
  let setStart = frames.findIndex((_, i) => i > minDrop && pelvisSpeed[i]! < 0.45);
  if (setStart < 0) setStart = minDrop;
  // ステップ：前足（左）が地面から離れる
  let strideStart = frames.findIndex((_, i) => i > setStart && ankleL[i]!.y > 0.1);
  if (strideStart < 0) strideStart = setStart + 1;
  // 接地：前足が地面に戻り、止まる
  let plant = frames.findIndex((_, i) => i > strideStart + 2 && ankleL[i]!.y < 0.095 && ankleLSpeed[i]! < 0.35);
  if (plant < 0) plant = strideStart + 1;
  // リリース：接地前後で投げる手首が最も速い瞬間
  const from = Math.max(0, plant - Math.round(0.1 * fps));
  const to = Math.min(last, plant + Math.round(0.3 * fps));
  let release = from;
  for (let i = from; i <= to; i++) if (wristSpeed[i]! > wristSpeed[release]!) release = i;
  // フォロースルー：手首の速さがピークの 45% を下回る
  const peak = wristSpeed[release]!;
  let followStart = frames.findIndex((_, i) => i > release && wristSpeed[i]! < peak * 0.45);
  if (followStart < 0) followStart = Math.min(last, release + 3);
  return { setStart, strideStart, plant, release, followStart, last };
}

export function toPhases(e: Events): Phase[] {
  return [
    { key: "drop", start: 0, end: e.setStart },
    { key: "set", start: e.setStart, end: e.strideStart },
    { key: "stride", start: e.strideStart, end: e.plant },
    { key: "release", start: e.plant, end: e.followStart },
    { key: "follow", start: e.followStart, end: e.last },
  ];
}

export function phaseAt(phases: Phase[], frame: number): PhaseKey {
  return (phases.find((p) => frame >= p.start && frame < p.end) ?? phases[phases.length - 1]!).key;
}

// ---- 指標 ----

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
};

export const METRICS: MetricDef[] = [
  { key: "releaseTime", label: "始動からリリース", short: "リリース時間", unit: "s", digits: 2, validAngles: ["side", "behind", "front", "endzone", "sideline"], axis: "release", at: "release", hint: "ステップ開始からボールが離れるまで" },
  { key: "strideRatio", label: "ステップ幅（身長比）", short: "ステップ幅", unit: "", digits: 2, validAngles: ["side"], axis: "footwork", at: "plant", hint: "前足の接地時の両足首の距離 ÷ 身長" },
  { key: "frontKnee", label: "接地時の前膝角度", short: "前膝角度", unit: "°", digits: 0, validAngles: ["side"], axis: "footwork", at: "plant", hint: "ブロックの強さ。伸びすぎも曲がりすぎも力が逃げる" },
  { key: "hipShoulderSep", label: "腰と肩の捻り差", short: "捻り差", unit: "°", digits: 0, validAngles: ["behind", "front"], axis: "rotation", at: "plant", hint: "接地時の骨盤と肩のラインの角度差の最大値" },
  { key: "sequenceGap", label: "骨盤→体幹のピーク間隔", short: "回転の間", unit: "ms", digits: 0, validAngles: ["side", "behind"], axis: "rotation", at: "release", hint: "キネマティックシーケンス。骨盤が先に回り、体幹が続くのが理想" },
  { key: "elbowHeight", label: "リリース時の肘の高さ", short: "肘の高さ", unit: "cm", digits: 0, validAngles: ["side", "behind"], axis: "armPath", at: "release", hint: "肩のラインからの高さ。マイナスは肩より下" },
  { key: "elbowAngle", label: "リリース時の肘角度", short: "肘角度", unit: "°", digits: 0, validAngles: ["side"], axis: "armPath", at: "release", hint: "肩・肘・手首の角度" },
  { key: "releaseHeight", label: "リリース点の高さ（身長比）", short: "リリース高", unit: "", digits: 2, validAngles: ["side"], axis: "release", at: "release", hint: "手首の高さ ÷ 身長" },
  { key: "trunkTilt", label: "リリース時の体幹の前傾", short: "前傾", unit: "°", digits: 0, validAngles: ["side"], axis: "posture", at: "release", hint: "腰から肩のラインと鉛直線の角度" },
  { key: "headStability", label: "頭の上下動", short: "頭の安定", unit: "cm", digits: 1, validAngles: ["side", "behind", "front", "endzone", "sideline"], axis: "base", at: "range", hint: "ドロップとセットの間の頭の高さの標準偏差" },
];

export const METRIC_BY_KEY = Object.fromEntries(METRICS.map((m) => [m.key, m])) as Record<MetricKey, MetricDef>;

export type MetricValues = Partial<Record<MetricKey, number>>;

export type AnalysisExtras = {
  /** 後方・正面の映像でのみ測れる値（デモでは合成データの設定値） */
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

  const heads = seq.frames.slice(0, e.strideStart).map((fr) => headCenter(fr).y);
  const mean = heads.reduce((a, b) => a + b, 0) / Math.max(1, heads.length);
  const sd = Math.sqrt(heads.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, heads.length));

  return {
    releaseTime: (e.release - e.strideStart) / seq.fps,
    strideRatio: Math.abs(kp(plant, "lAnkle").x - kp(plant, "rAnkle").x) / h,
    frontKnee: jointAngle(kp(plant, "lHip"), kp(plant, "lKnee"), kp(plant, "lAnkle")),
    hipShoulderSep: extras.hipShoulderSep,
    sequenceGap: extras.sequenceGapS !== undefined ? extras.sequenceGapS * 1000 : undefined,
    elbowHeight: (kp(rel, "rElbow").y - kp(rel, "rShoulder").y) * 100,
    elbowAngle: jointAngle(kp(rel, "rShoulder"), kp(rel, "rElbow"), kp(rel, "rWrist")),
    releaseHeight: kp(rel, "rWrist").y / h,
    trunkTilt: tilt,
    headStability: sd * 100,
  };
}

/** カメラ角度でその指標を判定できるか */
export function isValidFor(def: MetricDef, angle: CameraAngle) {
  return def.validAngles.includes(angle);
}

export function invalidReason(def: MetricDef, angle: CameraAngle) {
  const ok = def.validAngles.map((a) => CAMERA_LABEL[a]).join("・");
  return `${CAMERA_LABEL[angle]}の映像では測れません（${ok}の映像が必要）`;
}

// ---- 判定 ----

export type Zone = { p10: number; p25: number; p50: number; p75: number; p90: number };
export type Status = "good" | "caution" | "flag" | "na";

export const STATUS_LABEL: Record<Status, string> = {
  good: "良好",
  caution: "注意",
  flag: "要改善",
  na: "判定不可",
};

/** お手本ゾーンの中での位置で判定する：四分位の内側は良好、10〜90% は注意、その外は要改善 */
export function judge(value: number | undefined, zone: Zone | undefined): Status {
  if (value === undefined || zone === undefined) return "na";
  if (value >= zone.p25 && value <= zone.p75) return "good";
  if (value >= zone.p10 && value <= zone.p90) return "caution";
  return "flag";
}

/** 0〜100 の指標スコア。四分位の内側を満点とし、外れるほど下げる */
export function metricScore(value: number | undefined, zone: Zone | undefined): number | undefined {
  if (value === undefined || zone === undefined) return undefined;
  const iqr = Math.max(1e-6, zone.p75 - zone.p25);
  const out = value < zone.p25 ? zone.p25 - value : value > zone.p75 ? value - zone.p75 : 0;
  return Math.round(Math.max(40, 100 - 32 * (out / iqr)));
}

export function formatMetric(key: MetricKey, value: number | undefined) {
  if (value === undefined) return "—";
  const def = METRIC_BY_KEY[key];
  const v = value.toFixed(def.digits);
  return def.unit ? `${v} ${def.unit}` : v;
}
