import { motion } from "motion/react";
import { useId } from "react";
import type { Zone } from "../../domain/judgement";
import { PHASE_LABEL, type Phase } from "../../domain/phases";
import type { WeightParts } from "../../domain/weighting";
import { cx } from "./ui";

const lin = (d0: number, d1: number, r0: number, r1: number) => (v: number) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);

export const COLORS = {
  turf: "#2EE59D",
  pylon: "#FF7A1A",
  ice: "#5AC8FA",
  caution: "#FFC24B",
  flag: "#FF4D5E",
  muted: "#8A96A3",
  line: "rgba(255,255,255,0.08)",
};

// ---- スパークライン ----

export function Sparkline({ values, color = COLORS.turf, width = 120, height = 32, className }: { values: (number | undefined)[]; color?: string; width?: number; height?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  const pts = values.map((v, i) => ({ i, v })).filter((p): p is { i: number; v: number } => p.v !== undefined);
  if (pts.length < 2) return null;
  const lo = Math.min(...pts.map((p) => p.v));
  const hi = Math.max(...pts.map((p) => p.v));
  const x = lin(0, values.length - 1, 2, width - 2);
  const y = lin(lo, hi, height - 4, 4);
  const d = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i)} ${y(p.v)}`).join(" ");
  const last = pts[pts.length - 1]!;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={className} aria-hidden>
      <defs>
        <linearGradient id={`sp-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.25" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${x(last.i)} ${height} L${x(pts[0]!.i)} ${height} Z`} fill={`url(#sp-${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r={2.75} fill={color} />
    </svg>
  );
}

// ---- スコアのリング ----

export function ScoreRing({ value, size = 148, stroke = 10, color = COLORS.turf, children }: { value: number; size?: number; stroke?: number; color?: string; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - value / 100) }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          className="glow-turf"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

// ---- フェーズのタイムライン ----

const PHASE_FILL: Record<Phase["key"], string> = {
  drop: "var(--color-phase-drop)",
  set: "var(--color-phase-set)",
  stride: "var(--color-phase-stride)",
  release: "var(--color-phase-release)",
  follow: "var(--color-phase-follow)",
};

export function PhaseBar({ phases, frame, total, markers = [], onSeek }: { phases: Phase[]; frame: number; total: number; markers?: { frame: number; label: string }[]; onSeek?: (f: number) => void }) {
  const pct = (f: number) => `${(f / (total - 1)) * 100}%`;
  return (
    <div className="relative select-none">
      <div className="flex h-8 overflow-hidden rounded-lg">
        {phases.map((p) => {
          const on = frame >= p.start && frame < p.end;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onSeek?.(p.start)}
              style={{ width: pct(p.end - p.start + (p.key === "follow" ? 1 : 0)), background: PHASE_FILL[p.key] }}
              className={cx("relative flex items-center justify-center border-r border-ink text-[11px] font-medium transition-[filter] hover:brightness-125", p.key === "release" ? "text-ink" : "text-text/85", on && "brightness-125")}
              aria-label={`${PHASE_LABEL[p.key]}へ移動`}
            >
              <span className="truncate px-1">{PHASE_LABEL[p.key]}</span>
            </button>
          );
        })}
      </div>
      {markers.map((m, i) => (
        <div key={m.label} className="pointer-events-none absolute -top-1 bottom-0" style={{ left: pct(m.frame) }}>
          <div className="h-10 w-px bg-white/60" />
          {/* 近いイベントのラベルが重ならないよう、交互に左右へ寄せる */}
          <div className={cx("mt-0.5 whitespace-nowrap text-[10px] text-muted", i % 2 === 0 ? "-translate-x-full pr-1" : "pl-1")}>{m.label}</div>
        </div>
      ))}
      <motion.div className="pointer-events-none absolute -top-1.5 h-11 w-0.5 rounded bg-pylon glow-pylon" style={{ left: pct(frame) }} />
    </div>
  );
}

// ---- 時系列（フレーム軸） ----

export type Series = { label: string; values: number[]; color: string; dashed?: boolean; width?: number };

export function TimeChart({
  series,
  frame,
  height = 140,
  band,
  markers = [],
  unit = "",
  onSeek,
  yDomain,
}: {
  series: Series[];
  frame: number;
  height?: number;
  band?: { lo: number; hi: number; label: string };
  markers?: { frame: number; label: string }[];
  unit?: string;
  onSeek?: (f: number) => void;
  yDomain?: [number, number];
}) {
  const W = 800;
  const H = height;
  const pad = { l: 44, r: 12, t: 10, b: 20 };
  const n = Math.max(...series.map((s) => s.values.length));
  const all = series.flatMap((s) => s.values).concat(band ? [band.lo, band.hi] : []);
  const [lo, hi] = yDomain ?? [Math.min(0, ...all), Math.max(...all) * 1.08];
  const x = lin(0, n - 1, pad.l, W - pad.r);
  const y = lin(lo, hi, H - pad.b, pad.t);
  const ticks = [lo, (lo + hi) / 2, hi];
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="block w-full cursor-crosshair"
      onClick={(e) => {
        if (!onSeek) return;
        const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        const px = ((e.clientX - rect.left) / rect.width) * W;
        onSeek(Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (n - 1)));
      }}
      role="img"
      aria-label={series.map((s) => s.label).join("・")}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={COLORS.line} />
          <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={COLORS.muted} fontFamily="var(--font-mono)">
            {Math.round(t)}
            {unit}
          </text>
        </g>
      ))}
      {band && (
        <g>
          <rect x={pad.l} width={W - pad.l - pad.r} y={y(band.hi)} height={Math.max(1, y(band.lo) - y(band.hi))} fill={COLORS.ice} fillOpacity={0.1} />
          <text x={W - pad.r - 4} y={y(band.hi) - 4} textAnchor="end" fontSize={11} fill={COLORS.ice}>
            {band.label}
          </text>
        </g>
      )}
      {markers.map((m) => (
        <g key={m.label}>
          <line x1={x(m.frame)} x2={x(m.frame)} y1={pad.t} y2={H - pad.b} stroke="rgba(255,255,255,0.25)" strokeDasharray="3 4" />
          <text x={x(m.frame)} y={H - 6} textAnchor="middle" fontSize={10} fill={COLORS.muted}>
            {m.label}
          </text>
        </g>
      ))}
      {series.map((s) => (
        <path
          key={s.label}
          d={s.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ")}
          fill="none"
          stroke={s.color}
          strokeWidth={s.width ?? 2}
          strokeDasharray={s.dashed ? "5 5" : undefined}
          strokeLinejoin="round"
        />
      ))}
      <line x1={x(frame)} x2={x(frame)} y1={pad.t} y2={H - pad.b} stroke={COLORS.pylon} strokeWidth={1.5} />
      {series.map((s) => {
        const v = s.values[Math.min(frame, s.values.length - 1)];
        return v === undefined ? null : <circle key={s.label} cx={x(frame)} cy={y(v)} r={3.5} fill={s.color} stroke="#07090D" strokeWidth={1.5} />;
      })}
    </svg>
  );
}

// ---- レーダー ----

export function Radar({ labels, series, size = 300 }: { labels: string[]; series: { label: string; values: number[]; color: string; fill?: boolean; dashed?: boolean }[]; size?: number }) {
  const c = size / 2;
  const R = size / 2 - 44;
  const n = labels.length;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i / n) * 2 * Math.PI;
    const r = (Math.max(0, Math.min(100, v)) / 100) * R;
    return [c + r * Math.cos(a), c + r * Math.sin(a)] as const;
  };
  const poly = (vals: number[]) => vals.map((v, i) => pt(i, v).join(",")).join(" ");
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="block w-full" role="img" aria-label="観点ごとのスコア">
      {[25, 50, 75, 100].map((g) => (
        <polygon key={g} points={poly(labels.map(() => g))} fill="none" stroke={COLORS.line} />
      ))}
      <polygon points={poly(labels.map(() => 100))} fill={COLORS.ice} fillOpacity={0.05} stroke={COLORS.ice} strokeOpacity={0.35} strokeDasharray="4 4" />
      {labels.map((l, i) => {
        const [x, y] = pt(i, 100);
        const [lx, ly] = pt(i, 122);
        return (
          <g key={l}>
            <line x1={c} y1={c} x2={x} y2={y} stroke={COLORS.line} />
            <text x={lx} y={ly + 4} textAnchor="middle" fontSize={11} fill={COLORS.muted}>
              {l}
            </text>
          </g>
        );
      })}
      {series.map((s) => (
        <motion.polygon
          key={s.label}
          points={poly(s.values)}
          fill={s.fill ? s.color : "none"}
          fillOpacity={0.16}
          stroke={s.color}
          strokeWidth={2}
          strokeDasharray={s.dashed ? "5 4" : undefined}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          style={{ transformOrigin: `${c}px ${c}px` }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        />
      ))}
    </svg>
  );
}

// ---- お手本ゾーンの帯（指標カード用） ----

export function ZoneBar({ zone, value, best, className }: { zone?: Zone; value?: number; best?: number; className?: string }) {
  if (!zone) return <div className={cx("h-2 rounded-full bg-white/5", className)} />;
  const vals = [zone.p10, zone.p90, value, best].filter((v): v is number => v !== undefined);
  const span = Math.max(...vals) - Math.min(...vals) || 1;
  const lo = Math.min(...vals) - span * 0.15;
  const hi = Math.max(...vals) + span * 0.15;
  const p = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  return (
    <div className={cx("relative h-2", className)}>
      <div className="absolute inset-y-0 rounded-full bg-white/5" style={{ left: 0, right: 0 }} />
      <div className="absolute inset-y-0 rounded-full bg-ice/15" style={{ left: p(zone.p10), width: `calc(${p(zone.p90)} - ${p(zone.p10)})` }} />
      <div className="absolute inset-y-0 rounded-full bg-ice/40" style={{ left: p(zone.p25), width: `calc(${p(zone.p75)} - ${p(zone.p25)})` }} />
      {best !== undefined && <div className="absolute -inset-y-1 w-0.5 rounded bg-text/60" style={{ left: p(best) }} title="自己ベスト" />}
      {value !== undefined && <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-pylon" style={{ left: p(value) }} title="今回" />}
    </div>
  );
}

// ---- 重みの内訳 ----

const FACTORS: { k: keyof WeightParts; label: string; hint: string }[] = [
  { k: "P", label: "人気度", hint: "補正した高評価率 × 再生数" },
  { k: "C", label: "発信者", hint: "登録者数・信頼チャンネル" },
  { k: "Q", label: "解析品質", hint: "検出の信頼度・角度・画質" },
  { k: "K", label: "合意度", hint: "他のお手本との一致" },
  { k: "M", label: "手動調整", hint: "ピン留め・除外・星" },
];

export function FactorBars({ parts }: { parts?: WeightParts }) {
  return (
    <div className="space-y-2">
      {FACTORS.map((f) => {
        const v = parts?.[f.k] ?? 0;
        const low = v < 0.35;
        return (
          <div key={f.k} className="grid grid-cols-[86px_1fr_44px] items-center gap-3 text-xs">
            <div>
              <span className="font-mono text-ice">{f.k}</span> <span className="text-text/80">{f.label}</span>
            </div>
            <div className="relative h-2 overflow-hidden rounded-full bg-white/5" title={f.hint}>
              <motion.div className={cx("absolute inset-y-0 left-0 rounded-full", low ? "bg-flag/70" : "bg-ice/70")} initial={{ width: 0 }} animate={{ width: `${Math.min(1, v / 1.5) * 100}%` }} transition={{ duration: 0.6 }} />
              <div className="absolute inset-y-0 w-px bg-white/30" style={{ left: `${(1 / 1.5) * 100}%` }} />
            </div>
            <div className={cx("text-right font-mono", low ? "text-flag" : "text-text")}>{v.toFixed(2)}</div>
          </div>
        );
      })}
      <div className="mt-3 grid grid-cols-[86px_1fr_44px] items-center gap-3 border-t border-line pt-3 text-xs">
        <div className="font-medium">重み w</div>
        <div className="relative h-2.5 overflow-hidden rounded-full bg-white/5">
          <motion.div className="absolute inset-y-0 left-0 rounded-full bg-turf" initial={{ width: 0 }} animate={{ width: `${Math.min(1, (parts?.w ?? 0) / 1.2) * 100}%` }} transition={{ duration: 0.6 }} />
        </div>
        <div className="text-right font-mono text-turf">{(parts?.w ?? 0).toFixed(2)}</div>
      </div>
    </div>
  );
}

// ---- 重み付きヒストグラム ----

export function Histogram({
  samples,
  zone,
  you,
  best,
  digits = 2,
  bins = 14,
  compareZone,
}: {
  samples: { value: number; weight: number }[];
  zone?: Zone;
  you?: number;
  best?: number;
  digits?: number;
  bins?: number;
  compareZone?: Zone;
}) {
  const W = 640;
  const H = 180;
  const pad = { l: 12, r: 12, t: 22, b: 26 };
  const vals = samples.map((s) => s.value).concat([you, best].filter((v): v is number => v !== undefined));
  if (!vals.length) return null;
  const span = Math.max(...vals) - Math.min(...vals) || 1;
  const lo = Math.min(...vals) - span * 0.08;
  const hi = Math.max(...vals) + span * 0.08;
  const x = lin(lo, hi, pad.l, W - pad.r);
  const counts = Array.from({ length: bins }, () => 0);
  for (const s of samples) {
    const b = Math.min(bins - 1, Math.max(0, Math.floor(((s.value - lo) / (hi - lo)) * bins)));
    counts[b]! += s.weight;
  }
  const max = Math.max(...counts, 1e-6);
  const bw = (W - pad.l - pad.r) / bins;
  const y = lin(0, max, H - pad.b, pad.t);
  const marker = (v: number | undefined, color: string, label: string, pos: "top" | "bottom") =>
    v === undefined ? null : (
      <g>
        <line x1={x(v)} x2={x(v)} y1={pad.t - 6} y2={H - pad.b} stroke={color} strokeWidth={2} />
        <text x={x(v)} y={pos === "top" ? 12 : H - 8} textAnchor="middle" fontSize={11} fill={color}>
          {label} {v.toFixed(digits)}
        </text>
      </g>
    );
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="お手本の分布">
      {compareZone && <rect x={x(compareZone.p25)} width={Math.max(1, x(compareZone.p75) - x(compareZone.p25))} y={pad.t} height={H - pad.t - pad.b} fill="none" stroke={COLORS.caution} strokeDasharray="4 4" strokeOpacity={0.7} />}
      {zone && <rect x={x(zone.p25)} width={Math.max(1, x(zone.p75) - x(zone.p25))} y={pad.t} height={H - pad.t - pad.b} fill={COLORS.ice} fillOpacity={0.1} />}
      {counts.map((c, i) => (
        <motion.rect
          key={i}
          x={pad.l + i * bw + 2}
          width={bw - 4}
          rx={3}
          initial={{ y: H - pad.b, height: 0 }}
          animate={{ y: y(c), height: H - pad.b - y(c) }}
          transition={{ duration: 0.5, delay: i * 0.02 }}
          fill={COLORS.ice}
          fillOpacity={0.55}
        />
      ))}
      <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke={COLORS.line} />
      {zone && <line x1={x(zone.p50)} x2={x(zone.p50)} y1={pad.t} y2={H - pad.b} stroke={COLORS.ice} strokeDasharray="2 3" />}
      {marker(best, "#e8edf2", "自己ベスト", "bottom")}
      {marker(you, COLORS.pylon, "今回", "top")}
    </svg>
  );
}

// ---- 散布図 ----

export function Scatter({ groups, xLabel, yLabel }: { groups: { label: string; color: string; points: { x: number; y: number }[] }[]; xLabel: string; yLabel: string }) {
  const W = 420;
  const H = 300;
  const pad = { l: 44, r: 14, t: 14, b: 36 };
  const pts = groups.flatMap((g) => g.points);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const sx = Math.max(...xs) - Math.min(...xs) || 1;
  const sy = Math.max(...ys) - Math.min(...ys) || 1;
  const x = lin(Math.min(...xs) - sx * 0.2, Math.max(...xs) + sx * 0.2, pad.l, W - pad.r);
  const y = lin(Math.min(...ys) - sy * 0.2, Math.max(...ys) + sy * 0.2, H - pad.b, pad.t);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="リリース点の散布図">
      <rect x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={H - pad.t - pad.b} fill="none" stroke={COLORS.line} />
      {groups.map((g) => {
        const mx = g.points.reduce((a, p) => a + p.x, 0) / g.points.length;
        const my = g.points.reduce((a, p) => a + p.y, 0) / g.points.length;
        return (
          <g key={g.label}>
            {g.points.map((p, i) => (
              <motion.circle key={i} cx={x(p.x)} cy={y(p.y)} r={5} fill={g.color} fillOpacity={0.75} initial={{ r: 0 }} animate={{ r: 5 }} transition={{ delay: i * 0.03 }} />
            ))}
            <circle cx={x(mx)} cy={y(my)} r={11} fill="none" stroke={g.color} strokeWidth={1.5} strokeDasharray="3 3" />
          </g>
        );
      })}
      <text x={(pad.l + W - pad.r) / 2} y={H - 8} textAnchor="middle" fontSize={11} fill={COLORS.muted}>
        {xLabel}
      </text>
      <text x={12} y={(pad.t + H - pad.b) / 2} textAnchor="middle" fontSize={11} fill={COLORS.muted} transform={`rotate(-90 12 ${(pad.t + H - pad.b) / 2})`}>
        {yLabel}
      </text>
    </svg>
  );
}

// ---- 推移（セッション軸） ----

export function TrendChart({
  points,
  band,
  digits = 2,
  color = COLORS.turf,
}: {
  points: { label: string; mean?: number; min?: number; max?: number; note?: string }[];
  band?: Zone;
  digits?: number;
  color?: string;
}) {
  const W = 800;
  const H = 260;
  const pad = { l: 56, r: 20, t: 20, b: 34 };
  const vals = points.flatMap((p) => [p.min, p.max, p.mean]).concat(band ? [band.p10, band.p90] : []).filter((v): v is number => v !== undefined);
  const span = Math.max(...vals) - Math.min(...vals) || 1;
  const lo = Math.min(...vals) - span * 0.12;
  const hi = Math.max(...vals) + span * 0.12;
  const x = lin(0, points.length - 1, pad.l + 20, W - pad.r - 20);
  const y = lin(lo, hi, H - pad.b, pad.t);
  const valid = points.map((p, i) => ({ ...p, i })).filter((p) => p.mean !== undefined);
  const d = valid.map((p, k) => `${k ? "L" : "M"}${x(p.i)} ${y(p.mean!)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="セッションごとの推移">
      {band && (
        <g>
          <rect x={pad.l} width={W - pad.l - pad.r} y={y(band.p90)} height={y(band.p10) - y(band.p90)} fill={COLORS.ice} fillOpacity={0.05} />
          <rect x={pad.l} width={W - pad.l - pad.r} y={y(band.p75)} height={y(band.p25) - y(band.p75)} fill={COLORS.ice} fillOpacity={0.12} />
          <text x={W - pad.r - 4} y={y(band.p75) - 6} textAnchor="end" fontSize={11} fill={COLORS.ice}>
            お手本ゾーン
          </text>
        </g>
      )}
      {[lo + span * 0.12, (lo + hi) / 2, hi - span * 0.12].map((t) => (
        <text key={t} x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={COLORS.muted} fontFamily="var(--font-mono)">
          {t.toFixed(digits)}
        </text>
      ))}
      {points.map((p, i) => (
        <g key={p.label}>
          <text x={x(i)} y={H - 10} textAnchor="middle" fontSize={11} fill={COLORS.muted}>
            {p.label}
          </text>
          {p.min !== undefined && p.max !== undefined && <line x1={x(i)} x2={x(i)} y1={y(p.max)} y2={y(p.min)} stroke={color} strokeOpacity={0.35} strokeWidth={6} strokeLinecap="round" />}
          {p.mean === undefined && (
            <text x={x(i)} y={(pad.t + H - pad.b) / 2} textAnchor="middle" fontSize={11} fill={COLORS.muted}>
              {p.note ?? "—"}
            </text>
          )}
        </g>
      ))}
      <motion.path d={d} fill="none" stroke={color} strokeWidth={2.5} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1 }} className="glow-turf" />
      {valid.map((p) => (
        <circle key={p.label} cx={x(p.i)} cy={y(p.mean!)} r={5} fill="#07090D" stroke={color} strokeWidth={2.5} />
      ))}
    </svg>
  );
}
