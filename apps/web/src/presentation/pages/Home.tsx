import { IconArrowRight, IconBrandYoutube, IconDeviceMobile, IconFlame, IconPlus, IconTrendingUp } from "@tabler/icons-react";
import { motion } from "motion/react";
import { Link } from "react-router";
import { CAMERA_LABEL } from "../../domain/camera";
import type { Session } from "../../domain/entities";
import { formatMetric, METRIC_BY_KEY, METRICS, type MetricKey } from "../../domain/metrics";
import { ScoreRing, Sparkline } from "../components/charts";
import { PoseThumb } from "../components/scene";
import { Badge, Button, Card, CountUp, SectionTitle, StatusPill } from "../components/ui";
import { PageGuide } from "../guide/PageGuide";
import { useCoach } from "../state/benchmarks";
import { formatDate, repLabel } from "../state/session";

/** 主要指標として先に出すもの。測れていない指標（2D の映像の回転など）は飛ばして、測れたほかの指標で 4 つにする */
const KPIS: MetricKey[] = ["strideRatio", "elbowHeight", "sequenceGap", "releaseTime"];
const STATUS_COLOR = { good: "#2EE59D", caution: "#FFC24B", flag: "#FF4D5E", na: "#8A96A3" };

function sessionMean(s: Session, key: MetricKey) {
  const xs = s.reps.map((r) => r.metrics[key]).filter((v): v is number => v !== undefined);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;
}

export function Home() {
  const { coach, bench, source } = useCoach();
  const player = coach.player();
  const sessions = coach.sessions();
  const { session: current, rep } = coach.focus();
  const scored = sessions.filter((s) => coach.sessionScore(s, bench) !== undefined);
  const scoreOf = (s: Session) => coach.sessionScore(s, bench) ?? 0;
  const score = scoreOf(current);
  const prev = scored[scored.indexOf(current) - 1];
  const delta = prev ? score - scoreOf(prev) : 0;
  const peak = scored.filter((s) => s.id !== current.id).sort((a, b) => scoreOf(b) - scoreOf(a))[0];
  const top = coach.findings(rep, current.camera, bench)[0];
  const evals = coach.evaluate(rep, current.camera, bench);
  const kpis = [...new Set([...KPIS, ...METRICS.map((m) => m.key)])].filter((k) => evals.find((e) => e.key === k)?.value !== undefined).slice(0, 4);
  const best = bench.best;
  const today = new Date().toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">{today}</p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-tight">{player.name ? `おかえり、${player.name.split(" ")[1] ?? player.name}` : "おかえりなさい"}</h1>
        </div>
        <Link to={source === "local" ? "/footage" : "/sessions/new"}>
          <Button variant="primary">
            <IconPlus size={16} aria-hidden />
            {source === "local" ? "映像を取り込む" : "新規セッション"}
          </Button>
        </Link>
      </div>

      <PageGuide id="home" sessionId={current.id} />

      <div className="grid gap-5 lg:grid-cols-[1.05fr_1.4fr]">
        {/* 総合スコア */}
        <Card className="relative overflow-hidden p-6" data-tour="home-score">
          <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-turf/10 blur-3xl" />
          <SectionTitle right={<Badge>{formatDate(current.date)} · {current.title}</Badge>}>最新セッションのスコア</SectionTitle>
          <div className="flex items-center gap-6">
            <ScoreRing value={score}>
              <CountUp value={score} className="font-display text-5xl" />
              <span className="text-[11px] text-muted">/ 100</span>
            </ScoreRing>
            <div className="space-y-3">
              <div>
                <div className="text-xs text-muted">前回のドリル比</div>
                {prev ? (
                  <div className={delta >= 0 ? "font-display text-2xl text-turf" : "font-display text-2xl text-flag"}>
                    {delta >= 0 ? "+" : ""}
                    {delta}
                  </div>
                ) : (
                  <div className="font-display text-2xl text-muted">—</div>
                )}
              </div>
              {best && (
                <div>
                  <div className="text-xs text-muted">自己ベスト</div>
                  <div className="text-sm">
                    {formatDate(best.date)} {repLabel(best.index)}
                  </div>
                </div>
              )}
              {peak && scoreOf(peak) > score ? (
                <div className="flex items-center gap-1.5 text-xs text-caution">
                  <IconFlame size={14} aria-hidden />
                  {formatDate(peak.date)}（{scoreOf(peak)} 点）から {scoreOf(peak) - score} 点下がっています
                </div>
              ) : scored.length > 1 ? (
                <div className="flex items-center gap-1.5 text-xs text-turf">
                  <IconTrendingUp size={14} aria-hidden />
                  これまでで最も高いスコアです
                </div>
              ) : (
                <div className="text-xs text-muted">最初のセッションです。次の練習から推移を出します</div>
              )}
            </div>
          </div>
          <div className="mt-6">
            <div className="mb-1.5 flex justify-between text-[11px] text-muted">
              <span>ドリルのスコア推移</span>
              <span>{scored.length} セッション</span>
            </div>
            <Sparkline values={scored.map(scoreOf)} width={420} height={54} className="w-full" />
          </div>
        </Card>

        {/* 次に直すこと */}
        {top && (
          <Card className="grid overflow-hidden sm:grid-cols-[1fr_1.1fr]" data-tour="home-next">
            <Link to={`/sessions/${current.id}/studio?rep=${rep.index + 1}`} className="group relative block overflow-hidden bg-ink" aria-label="根拠のフレームを分析スタジオで見る">
              <PoseThumb frame={rep.seq.frames[top.frame]!} className="h-full w-full transition-transform duration-500 group-hover:scale-[1.03]" />
              <div className="absolute top-3 left-3">
                <Badge tone="pylon">
                  {repLabel(rep.index)} · {(top.frame / rep.seq.fps).toFixed(2)}s
                </Badge>
              </div>
            </Link>
            <div className="flex flex-col p-6">
              <SectionTitle>次に直すこと</SectionTitle>
              <StatusPill status={top.severity} className="self-start" />
              <h2 className="mt-3 text-xl font-semibold">{top.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{top.body}</p>
              <div className="mt-3 text-xs text-muted">
                目標：<span className="font-mono text-ice">{top.target}</span>
              </div>
              {top.drill && (
                <div className="mt-auto flex items-center gap-3 rounded-xl border border-line bg-white/[0.03] p-3">
                  <IconBrandYoutube size={20} className="shrink-0 text-flag" aria-hidden />
                  <div className="min-w-0 text-xs">
                    <div className="truncate text-text">{top.drill.label}</div>
                    <div className="truncate text-muted">
                      {coach.reference(top.drill.refId)?.channel} · {top.drill.at} から
                    </div>
                  </div>
                </div>
              )}
              <Link to={`/sessions/${current.id}/report`} className="mt-4 inline-flex items-center gap-1 text-sm text-turf hover:underline">
                レポートを見る <IconArrowRight size={15} aria-hidden />
              </Link>
            </div>
          </Card>
        )}
      </div>

      {/* 主要指標 */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k, i) => {
          const def = METRIC_BY_KEY[k];
          const e = evals.find((r) => r.key === k)!;
          return (
            <motion.div key={k} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i }}>
              <Card className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-xs text-muted">{def.short}</div>
                  <StatusPill status={e.status} />
                </div>
                <div className="mt-2 flex items-end justify-between gap-2">
                  <div className="font-display text-3xl">{formatMetric(k, e.value)}</div>
                  <Sparkline values={scored.map((s) => sessionMean(s, k))} color={STATUS_COLOR[e.status]} width={96} height={34} />
                </div>
                <div className="mt-2 text-[11px] text-muted">
                  お手本 <span className="font-mono text-ice">{e.zone ? `${e.zone.p25.toFixed(def.digits)}〜${e.zone.p75.toFixed(def.digits)}` : "—"}</span>
                  <span className="mx-1.5 text-faint">·</span>
                  ベスト <span className="font-mono text-text/80">{formatMetric(k, e.best)}</span>
                </div>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {/* 最近のセッション */}
      <Card className="p-5">
        <SectionTitle
          right={
            <Link to="/progress" className="text-xs text-muted hover:text-text">
              推移を見る
            </Link>
          }
        >
          最近のセッション
        </SectionTitle>
        <div className="divide-y divide-line">
          {[...sessions].reverse().map((s) => {
            const sc = coach.sessionScore(s, bench);
            const r = s.id === current.id ? rep : s.reps[0]!;
            return (
              <Link key={s.id} to={`/sessions/${s.id}/reps`} className="group grid grid-cols-[88px_1fr_auto] items-center gap-4 py-3 sm:grid-cols-[88px_1fr_120px_90px_60px]">
                <div className="overflow-hidden rounded-lg border border-line">
                  <PoseThumb frame={r.seq.frames[r.events.release]!} className="block aspect-video w-full" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm group-hover:text-turf">{s.title}</span>
                    <Badge tone={s.kind === "game" ? "pylon" : "neutral"}>{s.kind === "game" ? "試合" : "ドリル"}</Badge>
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {formatDate(s.date)} · {s.reps.length} レップ
                  </div>
                </div>
                <div className="hidden items-center gap-1.5 text-xs text-muted sm:flex">
                  {s.source === "youtube" ? <IconBrandYoutube size={15} aria-hidden /> : <IconDeviceMobile size={15} aria-hidden />}
                  {CAMERA_LABEL[s.camera]}
                </div>
                <div className="hidden text-right text-xs text-muted sm:block">{s.source === "youtube" ? "YouTube URL" : "ファイル"}</div>
                <div className="text-right font-display text-2xl">
                  {sc ?? (
                    <span className="text-sm text-faint" title="判定できる指標が少ないため">
                      —
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
