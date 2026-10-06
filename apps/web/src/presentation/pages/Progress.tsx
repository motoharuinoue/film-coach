import { IconTrophy } from "@tabler/icons-react";
import { useState } from "react";
import { CAMERA_LABEL } from "../../domain/camera";
import type { Session } from "../../domain/entities";
import { deviation } from "../../domain/judgement";
import { isValidFor, METRIC_BY_KEY, METRICS, type MetricKey, unitSuffix } from "../../domain/metrics";
import { TrendChart } from "../components/charts";
import { Badge, Card, PageHeader, SectionTitle, cx } from "../components/ui";
import { PageGuide } from "../guide/PageGuide";
import { useCoach } from "../state/benchmarks";
import { formatDate } from "../state/session";

type Target = "score" | MetricKey;

function stats(s: Session, key: MetricKey) {
  const xs = s.reps.map((r) => r.metrics[key]).filter((v): v is number => v !== undefined);
  if (!xs.length) return undefined;
  return { mean: xs.reduce((a, b) => a + b, 0) / xs.length, min: Math.min(...xs), max: Math.max(...xs) };
}

export function Progress() {
  const { coach, bench } = useCoach();
  const sessions = coach.sessions();
  const [target, setTarget] = useState<Target>("score");
  // 測れた値のある指標だけ（2D の映像では回転を測らない など）
  const metricKeys = METRICS.filter((m) => sessions.some((s) => isValidFor(m, s.camera) && s.reps.some((r) => r.metrics[m.key] !== undefined))).map((m) => m.key);

  const points =
    target === "score"
      ? sessions.map((s) => {
          const sc = coach.sessionScore(s, bench);
          const reps = s.reps.map((r) => coach.repScore(r, bench));
          return { label: formatDate(s.date), mean: sc, min: sc === undefined ? undefined : Math.min(...reps), max: sc === undefined ? undefined : Math.max(...reps), note: "スコアなし" };
        })
      : sessions.map((s) => {
          const def = METRIC_BY_KEY[target];
          const st = isValidFor(def, s.camera) ? stats(s, target) : undefined;
          return { label: formatDate(s.date), ...st, note: `${CAMERA_LABEL[s.camera]}では測れない` };
        });
  const def = target === "score" ? undefined : METRIC_BY_KEY[target];

  // 指標ごとの自己ベスト（お手本ゾーンの中央に最も近いレップ）
  // ゾーンは、レップの投げ始めに合うもの（投げ始めで意味が変わる指標は、投げ始めが同じお手本だけ）
  const records = METRICS.filter((m) => sessions.some((s) => s.reps.some((r) => coach.zonesOf(r, bench)[m.key]))).map((m) => {
    let best: { value: number; date: string; dist: number } | undefined;
    for (const s of sessions) {
      if (!isValidFor(m, s.camera)) continue;
      for (const r of s.reps) {
        const v = r.metrics[m.key];
        const z = coach.zonesOf(r, bench)[m.key];
        if (v === undefined || !z) continue;
        const d = deviation(v, z) * 10 + Math.abs(v - z.p50) / Math.max(1e-6, z.p75 - z.p25);
        if (!best || d < best.dist) best = { value: v, date: s.date, dist: d };
      }
    }
    return { m, best };
  });

  return (
    <div className="space-y-6">
      <PageHeader title="④ 続ける：推移" sub="セッションごとの平均と、レップ間の幅（最小〜最大）。帯はお手本ゾーン" />
      <PageGuide id="progress" />

      <Card className="p-5">
        <div className="mb-4 flex flex-wrap gap-1">
          {(["score", ...metricKeys] as Target[]).map((k) => (
            <button key={k} type="button" onClick={() => setTarget(k)} className={cx("rounded-md border px-2.5 py-1 text-xs", k === target ? "border-turf/50 bg-turf/10 text-turf" : "border-line text-muted hover:text-text")}>
              {k === "score" ? "スコア" : METRIC_BY_KEY[k].short}
            </button>
          ))}
        </div>
        <SectionTitle right={def && <span className="text-xs text-faint">{def.hint}</span>}>{def ? def.label : "メカニクス スコア"}</SectionTitle>
        {/* 投げ始めで意味が変わる指標は、お手本ゾーンが投げ始めごとに違うので帯を出さない */}
        <TrendChart points={points} band={target === "score" || def?.byApproach ? undefined : bench.zones[target]} digits={def ? def.digits : 0} />
      </Card>

      <Card className="p-5">
        <SectionTitle>指標ごとの自己ベスト</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {records.map(({ m, best }) => (
            <div key={m.key} className="flex items-center gap-3 rounded-xl border border-line bg-white/[0.02] p-3">
              <IconTrophy size={20} className="shrink-0 text-caution" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-muted">{m.label}</div>
                <div className="font-display text-xl">{best ? `${best.value.toFixed(m.digits)}${unitSuffix(m.unit)}` : "—"}</div>
              </div>
              {best && <Badge>{formatDate(best.date)}</Badge>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
