// お手本の重み付けの検証（docs/adr/0006-reference-weighting.md）。
// 重みの付け方を変えて、お手本ゾーンが「お手本の選び方」と「人気の高い外れ値」でどれだけ動くかを比べる。

import { METRIC_BY_KEY, METRICS, isValidFor, type MetricKey } from "./metrics";
import { rng } from "./random";
import { computeWeights, weightedQuantile, type ReferenceStats, type WeightedReference, type WeightParts } from "./weighting";

export type Scheme = "full" | "noConsensus" | "popularity" | "uniform";

export const SCHEMES: Scheme[] = ["full", "noConsensus", "popularity", "uniform"];

export const SCHEME_LABEL: Record<Scheme, string> = {
  full: "P×C×Q×K×M",
  noConsensus: "一致度 K を除く",
  popularity: "人気度 P だけ",
  uniform: "すべて同じ重み",
};

/** 重みの内訳から、付け方ごとの重みを求める。撮影の角度が合わない（Q = 0）・除外した（M = 0）標本は、どの付け方でも使わない */
export function schemeWeight(p: WeightParts, scheme: Scheme): number {
  if (p.Q <= 0 || p.M <= 0) return 0;
  switch (scheme) {
    case "full":
      return p.w;
    case "noConsensus":
      return p.P * p.C * p.Q * p.M;
    case "popularity":
      return p.P;
    case "uniform":
      return 1;
  }
}

/** お手本 1 本ぶんの標本（レップ）。ブートストラップでは、お手本の単位で選び直す */
export type ValidationGroup = { id: string; samples: WeightedReference[] };

/** 検証に使う四分位（お手本ゾーンの下端・中央・上端） */
const QUARTILES = [0.25, 0.5, 0.75] as const;
type Quartiles = [number, number, number];

/** 検証する指標：投げ始めごとに分布を作る指標は、投げ始めを分けない全体の分布では判定に使わないため除く */
const TARGETS = METRICS.filter((m) => !m.byApproach);

/** 検証に必要なお手本の本数。2 本では、選び直しても組み合わせがほとんど変わらない */
export const MIN_GROUPS = 3;

function quartilesBy(samples: WeightedReference[]): Partial<Record<MetricKey, Record<Scheme, Quartiles>>> {
  const result = computeWeights(samples);
  const out: Partial<Record<MetricKey, Record<Scheme, Quartiles>>> = {};
  for (const def of TARGETS) {
    const values = samples.map((s) => s.metrics[def.key] ?? Number.NaN);
    const byScheme = {} as Record<Scheme, Quartiles>;
    for (const scheme of SCHEMES) {
      const ws = samples.map((s, i) => {
        const p = result.parts[s.id]?.[def.key];
        return p && Number.isFinite(values[i]) ? schemeWeight(p, scheme) : 0;
      });
      // computeWeights と同じく、重みの付いた標本が 2 つ以上なければゾーンを作らない
      if (ws.filter((w) => w > 0).length < 2) break;
      byScheme[scheme] = QUARTILES.map((q) => weightedQuantile(values, ws, q)!) as Quartiles;
    }
    if (SCHEMES.every((s) => byScheme[s])) out[def.key] = byScheme;
  }
  return out;
}

/** 指標を測れたお手本（撮影の角度が合い、値があるもの）と、その値の幅（最大 − 最小） */
function coverage(groups: ValidationGroup[], metric: MetricKey) {
  const def = METRIC_BY_KEY[metric];
  const used = groups.filter((g) => g.samples.some((s) => s.metrics[metric] !== undefined && isValidFor(def, s.stats.camera) && !s.manual.excluded));
  const values = used.flatMap((g) => g.samples.map((s) => s.metrics[metric]).filter((v): v is number => v !== undefined));
  const range = values.length ? Math.max(...values) - Math.min(...values) : 0;
  return { used, values, range };
}

const sd = (xs: number[]) => {
  const m = xs.reduce((a, x) => a + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1));
};

export type MetricValidation = {
  metric: MetricKey;
  /** 指標を測れたお手本の本数 */
  groups: number;
  /** お手本の値の幅（最大 − 最小）。揺れとずれは、この幅に対する割合で示す */
  range: number;
  /** ブートストラップでの四分位の標準偏差の平均（値の幅に対する割合） */
  spread: Record<Scheme, number>;
  /** 人気の高い外れ値を 1 本加えたときの、四分位の動きの平均（値の幅に対する割合）。outlierDistances の順 */
  shift: Record<Scheme, number>[];
};

export type WeightValidation = {
  metrics: MetricValidation[];
  /** 指標をまたいだ平均 */
  mean: { spread: Record<Scheme, number>; shift: Record<Scheme, number>[] };
  iterations: number;
  outlierDistances: number[];
};

export type ValidationOptions = {
  /** ブートストラップの回数 */
  iterations?: number;
  seed?: number;
  /** 外れ値を、既存のお手本の最大値から値の幅の何倍だけ外すか（複数の距離で試す） */
  outlierDistances?: number[];
};

/** 外れ値として加える、人気の高い動画の統計（再生数 500 万回・高評価率 3%・登録者数 200 万人） */
export const POPULAR_OUTLIER: Pick<ReferenceStats, "views" | "likes" | "subscribers" | "trustedChannel"> = {
  views: 5_000_000,
  likes: 150_000,
  subscribers: 2_000_000,
  trustedChannel: false,
};

/**
 * ブートストラップ：お手本を重複を許して同じ本数だけ選び直し、重みとゾーンを計算し直すことをくり返す。
 * 四分位の標準偏差が小さいほど、ゾーンが「たまたま選んだお手本」に左右されにくい
 */
function bootstrap(groups: ValidationGroup[], iterations: number, seed: number) {
  const rand = rng(seed);
  const draws: Partial<Record<MetricKey, Record<Scheme, Quartiles[]>>> = {};
  for (let it = 0; it < iterations; it++) {
    // 同じお手本を 2 回選んだときも別の標本として扱えるよう、ID に選んだ順番を付ける
    const samples = Array.from({ length: groups.length }, (_, k) => {
      const g = groups[Math.floor(rand() * groups.length)]!;
      return g.samples.map((s) => ({ ...s, id: `${k}:${s.id}` }));
    }).flat();
    const qs = quartilesBy(samples);
    for (const [metric, byScheme] of Object.entries(qs) as [MetricKey, Record<Scheme, Quartiles>][]) {
      const d = (draws[metric] ??= { full: [], noConsensus: [], popularity: [], uniform: [] });
      for (const s of SCHEMES) d[s].push(byScheme[s]);
    }
  }
  return draws;
}

/**
 * 外れ値への強さ：人気の高い動画（POPULAR_OUTLIER）が、既存のお手本の最大値より値の幅の distance 倍だけ大きい値を持つとして加え、
 * 四分位がどれだけ動くかを見る。
 * 撮影の角度・画質・検出の確かさは、その指標を測れた既存のお手本と同じにする。レップの数は、既存のお手本の中央値にそろえる
 */
function outlierShift(groups: ValidationGroup[], metric: MetricKey, distance: number): Record<Scheme, number> | undefined {
  const { used, values, range } = coverage(groups, metric);
  if (range <= 0) return undefined;
  const def = METRIC_BY_KEY[metric];
  const template = used.flatMap((g) => g.samples).find((s) => isValidFor(def, s.stats.camera))!;
  const counts = used.map((g) => g.samples.length).sort((a, b) => a - b);
  const reps = counts[Math.floor(counts.length / 2)]!;
  const outlier = Array.from(
    { length: reps },
    (_, i): WeightedReference => ({
      id: `__outlier__#${i}`,
      stats: { ...template.stats, ...POPULAR_OUTLIER },
      manual: { pinned: false, excluded: false, stars: 3 },
      metrics: { [metric]: Math.max(...values) + distance * range },
    }),
  );
  const samples = used.flatMap((g) => g.samples);
  const before = quartilesBy(samples)[metric];
  const after = quartilesBy([...samples, ...outlier])[metric];
  if (!before || !after) return undefined;
  return Object.fromEntries(
    SCHEMES.map((s) => [s, before[s].reduce((a, q, i) => a + Math.abs(after[s][i]! - q), 0) / QUARTILES.length / range]),
  ) as Record<Scheme, number>;
}

const zeros = (): Record<Scheme, number> => ({ full: 0, noConsensus: 0, popularity: 0, uniform: 0 });

/** 重みの付け方ごとに、ゾーンの揺れ（ブートストラップ）と、人気の高い外れ値によるずれを求める */
export function validateWeighting(groups: ValidationGroup[], options: ValidationOptions = {}): WeightValidation {
  const { iterations = 1000, seed = 1, outlierDistances = [1, 3] } = options;
  const draws = bootstrap(groups, iterations, seed);
  const metrics: MetricValidation[] = [];
  for (const def of TARGETS) {
    const { used, range } = coverage(groups, def.key);
    const d = draws[def.key];
    const shifts = outlierDistances.map((x) => outlierShift(groups, def.key, x));
    if (used.length < MIN_GROUPS || range <= 0 || !d || shifts.some((x) => !x)) continue;
    const shift = shifts as Record<Scheme, number>[];
    const spread = Object.fromEntries(
      SCHEMES.map((s) => [s, QUARTILES.reduce((a, _, i) => a + sd(d[s].map((q) => q[i]!)), 0) / QUARTILES.length / range]),
    ) as Record<Scheme, number>;
    metrics.push({ metric: def.key, groups: used.length, range, spread, shift });
  }
  const mean = { spread: zeros(), shift: outlierDistances.map(zeros) };
  for (const m of metrics)
    for (const s of SCHEMES) {
      mean.spread[s] += m.spread[s] / metrics.length;
      m.shift.forEach((x, i) => (mean.shift[i]![s] += x[s] / metrics.length));
    }
  return { metrics, mean, iterations, outlierDistances };
}
