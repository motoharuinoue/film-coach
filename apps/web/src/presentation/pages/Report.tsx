import { IconCheck, IconCircleCheck, IconLink, IconPrinter } from "@tabler/icons-react";
import { motion } from "motion/react";
import { useState } from "react";
import { formatMetric, METRIC_BY_KEY, RADAR_LABEL, type RadarAxis } from "../../domain/metrics";
import { Radar, ScoreRing, Scatter } from "../components/charts";
import { fitCamera } from "../components/camera";
import { AngleArc, FieldScene, PoseThumb, Skeleton, Trail } from "../components/scene";
import { Badge, Button, CountUp, SectionTitle, StatusPill, cx } from "../components/ui";
import type { Finding } from "../../application/coaching";
import { DrillLink } from "../components/drill";
import { NarrationSource, useNarration, useNarrator } from "../state/narration";
import { PageGuide } from "../guide/PageGuide";
import { useCoach } from "../state/benchmarks";
import { formatDate, repLabel, useSessionRep } from "../state/session";

const AXES: RadarAxis[] = ["footwork", "base", "rotation", "armPath", "release", "posture", "consistency"];

/** 改善点の文章。手元の LLM が使えれば、その文章（数値を確かめたもの） */
function FindingText({ f }: { f: Finding }) {
  const { narration, pending } = useNarration(f);
  return (
    <>
      <h3 className="mt-2 text-lg font-semibold">{narration?.title ?? f.title}</h3>
      <p className={cx("mt-1.5 text-sm leading-relaxed text-muted", pending && "opacity-60")}>{narration?.body ?? f.body}</p>
      <NarrationSource narration={narration} pending={pending} />
    </>
  );
}

export function Report() {
  const { session, rep } = useSessionRep();
  const { coach, bench, source } = useCoach();
  const narrator = useNarrator();
  const [copied, setCopied] = useState(false);
  const player = coach.player();
  const findings = coach.findings(rep, session.camera, bench);
  const goods = coach.strengths(rep, session.camera, bench);
  const score = coach.repScore(rep, bench);
  const radar = coach.radar(rep, session, bench);
  const best = bench.best;
  const bestSession = best && coach.session(best.sessionId);
  const bestRadar = best && bestSession ? coach.radar(best, bestSession, bench) : undefined;
  const cons = coach.consistency(session);
  const hero = findings[0];
  const heroFrame = rep.seq.frames[hero?.frame ?? rep.events.release]!;
  const sources = coach
    .references()
    .map((r) => ({ r, w: bench.weights.overall[r.id] ?? 0 }))
    .sort((a, b) => b.w - a.w);

  const copy = async () => {
    await navigator.clipboard.writeText(location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="mx-auto max-w-[1040px] space-y-6">
      <PageGuide id="report" sessionId={session.id} />
      <div className="no-print flex flex-wrap items-center justify-end gap-2">
        <Button onClick={copy}>
          {copied ? <IconCheck size={15} aria-hidden /> : <IconLink size={15} aria-hidden />}
          {copied ? "コピーしました" : "リンクをコピー"}
        </Button>
        <Button variant="primary" onClick={() => window.print()}>
          <IconPrinter size={15} aria-hidden /> PDF に出力
        </Button>
      </div>

      <article className="print-light card overflow-hidden">
        {/* 表紙 */}
        <header className="relative">
          <FieldScene className="block w-full" cam={fitCamera(rep.seq.frames, 4)}>
            <Trail frames={rep.seq.frames} joint="rWrist" from={rep.events.strideStart} to={rep.events.followStart} />
            <Skeleton frame={heroFrame} />
            <AngleArc frame={heroFrame} a="rShoulder" b="rElbow" c="rWrist" label="肘" />
          </FieldScene>
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink via-ink/80 to-transparent px-8 pt-24 pb-7">
            <div className="font-display text-sm tracking-[0.3em] text-turf">COACHING REPORT</div>
            <h1 className="mt-2 text-3xl leading-tight font-semibold md:text-4xl">{hero ? `${hero.title}。ここを直せば動きがつながる` : "大きな崩れはありません"}</h1>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
              <span>
                {player.name ?? "あなた"}
                {player.number !== undefined && ` #${player.number}`}（{player.position}）
              </span>
              <span>
                {formatDate(session.date)} {session.title} · {repLabel(rep.index)}
              </span>
              {best && <span>比較：自己ベスト {formatDate(best.date)}</span>}
            </div>
          </div>
        </header>

        <div className="space-y-10 p-8">
          {/* スコア */}
          <section className="grid items-center gap-8 md:grid-cols-[auto_1fr]">
            <div className="flex flex-col items-center gap-3">
              <ScoreRing value={score} size={170}>
                <CountUp value={score} className="font-display text-6xl" />
                <span className="text-xs text-muted">メカニクス スコア</span>
              </ScoreRing>
              <div className="text-xs text-muted">お手本ゾーンを満点とした、判定できた指標の平均</div>
            </div>
            <div className="grid items-center gap-4 sm:grid-cols-[1fr_200px]">
              <div className="mx-auto w-full max-w-[340px]">
                <Radar
                  labels={AXES.map((a) => RADAR_LABEL[a])}
                  series={[
                    ...(bestRadar ? [{ label: "自己ベスト", values: AXES.map((a) => bestRadar[a] ?? 0), color: "#e8edf2", dashed: true }] : []),
                    { label: "今回", values: AXES.map((a) => radar[a] ?? 0), color: "#2EE59D", fill: true },
                  ]}
                />
              </div>
              <ul className="space-y-1.5 text-xs">
                {AXES.map((a) => (
                  <li key={a} className="flex justify-between gap-2 border-b border-line pb-1.5">
                    <span className="text-muted">{RADAR_LABEL[a]}</span>
                    <span className="font-mono">{radar[a] === undefined ? "—" : Math.round(radar[a]!)}</span>
                  </li>
                ))}
                <li className="flex gap-3 pt-1 text-[11px] text-faint">
                  <span className="text-turf">━ 今回</span>
                  <span>┅ 自己ベスト</span>
                  <span className="text-ice">┅ お手本ゾーン</span>
                </li>
              </ul>
            </div>
          </section>

          {/* 改善点 */}
          <section data-tour="report-findings">
            <SectionTitle>改善点トップ {findings.length}</SectionTitle>
            <div className="space-y-4">
              {findings.map((f, i) => (
                <motion.div key={f.key} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08 }} className="grid gap-5 rounded-2xl border border-line bg-white/[0.02] p-5 md:grid-cols-[220px_1fr]">
                  <div className="relative overflow-hidden rounded-xl border border-line">
                    <PoseThumb frame={rep.seq.frames[f.frame]!} className="block aspect-video w-full" />
                    <span className="absolute top-2 left-2 font-display text-3xl text-pylon">{String(i + 1).padStart(2, "0")}</span>
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill status={f.severity} />
                      <span className="text-xs text-muted">{METRIC_BY_KEY[f.key].label}</span>
                    </div>
                    <FindingText f={f} />
                    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
                      <span>
                        今回 <span className="font-mono text-pylon">{formatMetric(f.key, rep.metrics[f.key])}</span>
                      </span>
                      <span>
                        目標 <span className="font-mono text-ice">{f.target}</span>
                      </span>
                      <span className="text-muted">根拠 {(f.frame / rep.seq.fps).toFixed(2)}s</span>
                    </div>
                    {f.drill && <DrillLink drill={f.drill} className="mt-3 inline-flex max-w-full" />}
                  </div>
                </motion.div>
              ))}
            </div>
          </section>

          {/* 良かった点と一貫性 */}
          <section className="grid gap-8 md:grid-cols-2">
            <div>
              <SectionTitle>良かった点</SectionTitle>
              <ul className="space-y-2">
                {goods.map((k) => (
                  <li key={k} className="flex items-center justify-between gap-3 rounded-lg bg-turf/[0.05] px-3 py-2 text-sm">
                    <span className="flex items-center gap-2">
                      <IconCircleCheck size={16} className="text-turf" aria-hidden />
                      {METRIC_BY_KEY[k].label}
                    </span>
                    <span className="font-mono text-xs text-muted">{formatMetric(k, rep.metrics[k])}</span>
                  </li>
                ))}
                {goods.length === 0 && <li className="text-sm text-muted">お手本ゾーンに入っている指標はまだありません。</li>}
              </ul>
            </div>
            <div>
              <SectionTitle right={<Badge tone={cons.score >= 85 ? "turf" : "caution"}>ばらつき {cons.spread.toFixed(1)} cm</Badge>}>一貫性（リリース点）</SectionTitle>
              <Scatter
                xLabel="後ろ足からの前後位置（cm）"
                yLabel="高さ（cm）"
                groups={[
                  ...(bestSession ? [{ label: "自己ベストの回", color: "#5AC8FA", points: coach.releasePoints(bestSession) }] : []),
                  { label: "今回", color: "#2EE59D", points: coach.releasePoints(session) },
                ]}
              />
              <div className="mt-1 flex gap-4 text-[11px] text-muted">
                <span className="text-turf">● 今回（{formatDate(session.date)}）</span>
                {bestSession && <span className="text-ice">● 自己ベストの回（{formatDate(bestSession.date)}）</span>}
              </div>
            </div>
          </section>

          {/* 出典 */}
          <section>
            <SectionTitle>参照したお手本（重みの大きい順）</SectionTitle>
            <table className="w-full text-xs">
              <tbody>
                {sources.map(({ r, w }) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="py-2 pr-3 text-muted">{r.channel}</td>
                    <td className="py-2 pr-3">{r.title}</td>
                    <td className="py-2 pr-3 font-mono text-muted">
                      {r.segment.start}〜{r.segment.end}
                    </td>
                    <td className="py-2 pr-3">{r.creativeCommons ? <Badge tone="ice">CC</Badge> : <Badge>標準ライセンス</Badge>}</td>
                    <td className="py-2 text-right font-mono text-turf">{w.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <footer className="border-t border-line pt-5 text-[11px] leading-relaxed text-faint">
            判定はルールエンジンが行い、
            {narrator.ok && narrator.narrator ? `改善点の文章は手元の LLM（${narrator.narrator.model}）が判定結果をもとに書いています。文章中の数値は判定結果と、ドリル動画は登録済みのものと照合し、合わなければテンプレートの文章に切り替えます。` : "文章はテンプレートで作成しています（数値は判定結果のものだけを使います）。"}単眼 2D 映像による推定のため、角度・距離には誤差があります。
            {source === "demo" ? "チャンネル・動画・選手はすべて架空のデモデータです。" : "お手本は YouTube から取り込んだ区間で、元の動画は解析のあとに消し、骨格・指標と出典だけを残しています。"}
          </footer>
        </div>
      </article>
    </div>
  );
}
