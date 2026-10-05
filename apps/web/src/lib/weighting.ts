// お手本の重み付け（docs/adr/0006-reference-weighting.md）
// w(お手本, 指標) = P × C × Q(指標) × K(指標) × M

import { METRICS, isValidFor, type CameraAngle, type MetricKey, type MetricValues, type Zone } from "./analysis";

export type ReferenceStats = {
  views: number;
  likes: number;
  subscribers: number;
  trustedChannel: boolean;
  camera: CameraAngle;
  resolution: 480 | 720 | 1080 | 2160;
  fps: number;
  confidence: number;
};

export type ManualAdjust = { pinned: boolean; excluded: boolean; stars: 1 | 2 | 3 | 4 | 5 };

export type WeightParts = { P: number; C: number; Q: number; K: number; M: number; w: number };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// ベイズ平均の事前分布：高評価率 3%、再生数 5,000 回ぶんの重み
const PRIOR_RATE = 0.03;
const PRIOR_VIEWS = 5000;

/** 人気度：補正した高評価率と再生数（対数）の幾何平均。0.3 を下限にして、無名でも良い動画を残す */
export function popularity(s: ReferenceStats) {
  const rate = (s.likes + PRIOR_VIEWS * PRIOR_RATE) / (s.views + PRIOR_VIEWS);
  const rateScore = clamp01(rate / 0.06);
  const viewScore = clamp01(Math.log10(Math.max(1, s.views)) / 7);
  return { P: 0.3 + 0.7 * Math.sqrt(rateScore * viewScore), bayesRate: rate };
}

/** 発信者：登録者数（対数）。信頼チャンネルは 1.25 倍（上限 1） */
export function creator(s: ReferenceStats) {
  const base = 0.4 + 0.6 * clamp01(Math.log10(Math.max(1, s.subscribers)) / 6.5);
  return Math.min(1, base * (s.trustedChannel ? 1.25 : 1));
}

/** 解析品質：検出の信頼度 × カメラ角度の適否 × 解像度 × fps */
export function quality(s: ReferenceStats, metric: MetricKey) {
  const def = METRICS.find((m) => m.key === metric)!;
  if (!isValidFor(def, s.camera)) return 0;
  const res = s.resolution >= 1080 ? 1 : s.resolution >= 720 ? 0.85 : 0.6;
  const fps = s.fps >= 60 ? 1 : 0.85;
  return clamp01(s.confidence) * res * fps;
}

export function manual(m: ManualAdjust) {
  if (m.excluded) return 0;
  return (m.pinned ? 1.5 : 1) * (0.7 + 0.1 * m.stars);
}

/** 重み付き分位点（線形補間） */
export function weightedQuantile(values: number[], weights: number[], q: number): number | undefined {
  const pairs = values
    .map((v, i) => ({ v, w: weights[i] ?? 0 }))
    .filter((p) => p.w > 0 && Number.isFinite(p.v))
    .sort((a, b) => a.v - b.v);
  if (pairs.length === 0) return undefined;
  if (pairs.length === 1) return pairs[0]!.v;
  const total = pairs.reduce((a, p) => a + p.w, 0);
  // 各点を累積重みの中央に置き、その間を線形補間する
  let acc = 0;
  const pos = pairs.map((p) => {
    const c = (acc + p.w / 2) / total;
    acc += p.w;
    return c;
  });
  if (q <= pos[0]!) return pairs[0]!.v;
  for (let i = 1; i < pairs.length; i++) {
    if (q <= pos[i]!) {
      const t = (q - pos[i - 1]!) / (pos[i]! - pos[i - 1]!);
      return pairs[i - 1]!.v + t * (pairs[i]!.v - pairs[i - 1]!.v);
    }
  }
  return pairs[pairs.length - 1]!.v;
}

/** 合意度：重み付き中央値と MAD によるロバスト z。z が大きいほどコーシー型で重みを下げる */
export function consensus(values: (number | undefined)[], baseWeights: number[]): number[] {
  const idx = values.map((v, i) => (v === undefined || baseWeights[i] === 0 ? -1 : i)).filter((i) => i >= 0);
  if (idx.length < 3) return values.map(() => 1);
  const vs = idx.map((i) => values[i]!);
  const ws = idx.map((i) => baseWeights[i]!);
  const med = weightedQuantile(vs, ws, 0.5)!;
  const mad = weightedQuantile(
    vs.map((v) => Math.abs(v - med)),
    ws,
    0.5,
  )!;
  const scale = Math.max(1e-6, 1.4826 * mad);
  return values.map((v) => {
    if (v === undefined) return 1;
    const z = Math.abs(v - med) / scale;
    return 1 / (1 + (z / 2.5) ** 2);
  });
}

export type WeightedReference = {
  id: string;
  stats: ReferenceStats;
  manual: ManualAdjust;
  metrics: MetricValues;
};

export type WeightResult = {
  parts: Record<string, Partial<Record<MetricKey, WeightParts>>>;
  zones: Partial<Record<MetricKey, Zone>>;
  /** 指標をまたいだお手本ごとの代表重み（有効な指標の平均） */
  overall: Record<string, number>;
};

export function computeWeights(refs: WeightedReference[]): WeightResult {
  const parts: WeightResult["parts"] = Object.fromEntries(refs.map((r) => [r.id, {}]));
  const zones: WeightResult["zones"] = {};
  for (const def of METRICS) {
    const base = refs.map((r) => {
      const P = popularity(r.stats).P;
      const C = creator(r.stats);
      const Q = quality(r.stats, def.key);
      const M = manual(r.manual);
      return { P, C, Q, M, pre: r.metrics[def.key] === undefined ? 0 : P * C * Q * M };
    });
    const values = refs.map((r) => r.metrics[def.key]);
    const K = consensus(
      values,
      base.map((b) => b.pre),
    );
    const ws = base.map((b, i) => b.pre * K[i]!);
    refs.forEach((r, i) => {
      const b = base[i]!;
      parts[r.id]![def.key] = { P: b.P, C: b.C, Q: b.Q, K: K[i]!, M: b.M, w: ws[i]! };
    });
    const vs = values.map((v) => v ?? Number.NaN);
    if (ws.filter((w) => w > 0).length >= 2) {
      const q = (p: number) => weightedQuantile(vs, ws, p)!;
      zones[def.key] = { p10: q(0.1), p25: q(0.25), p50: q(0.5), p75: q(0.75), p90: q(0.9) };
    }
  }
  const overall = Object.fromEntries(
    refs.map((r) => {
      const ws = Object.values(parts[r.id]!).filter((p) => p.Q > 0);
      return [r.id, ws.length ? ws.reduce((a, p) => a + p.w, 0) / ws.length : 0];
    }),
  );
  return { parts, zones, overall };
}
