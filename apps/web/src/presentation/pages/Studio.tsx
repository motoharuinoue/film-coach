import {
  IconChevronLeft,
  IconChevronRight,
  IconMessageCircle,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerSkipBack,
  IconPlayerSkipForward,
  IconRepeat,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { alignedFrame, applyFit, fitTo, type Alignable } from "../../domain/align";
import { CAMERA_LABEL } from "../../domain/camera";
import type { AnalyzedRep, Session } from "../../domain/entities";
import { formatMetric, invalidReason, isValidFor, METRIC_BY_KEY } from "../../domain/metrics";
import { impreciseReason, noZoneReason } from "../../application/judgeThrows";
import { PHASE_LABEL, phaseAt } from "../../domain/phases";
import { jointAngle, kp, speedSeries } from "../../domain/pose";
import { PhaseBar, TimeChart, ZoneBar } from "../components/charts";
import { fitCamera } from "../components/camera";
import { AngleArc, FieldScene, Hud, Skeleton, Trail } from "../components/scene";
import { Badge, Button, Card, Kbd, SectionTitle, Segmented, StatusIcon, Toggle, cx } from "../components/ui";
import { PageGuide } from "../guide/PageGuide";
import { usePlayback } from "../hooks/usePlayback";
import { useCoach } from "../state/benchmarks";
import { formatDate, repLabel, useSessionRep } from "../state/session";
import { CompareView } from "./studio/CompareView";

type GhostTarget = "none" | "best" | string;

function AnalysisView({ session, rep }: { session: Session; rep: AnalyzedRep }) {
  const { coach, bench, source } = useCoach();
  // 投げ始めで意味が変わる指標は、投げ始めが同じお手本のゾーン
  const zones = coach.zonesOf(rep, bench);
  const pb = usePlayback(rep.seq.frames.length, rep.seq.fps, { initialRate: 0.25 });
  const [layers, setLayers] = useState({ skeleton: true, angles: true, trail: true });
  const [ghostTarget, setGhostTarget] = useState<GhostTarget>("best");
  const sideRefs = coach.references().filter((r) => r.stats.camera === "side");

  const ghost = useMemo<(Alignable & { label: string }) | undefined>(() => {
    if (ghostTarget === "none") return undefined;
    if (ghostTarget === "best") return bench.best && { ...bench.best, label: `自己ベスト（${formatDate(bench.best.date)}）` };
    const ref = coach.reference(ghostTarget);
    return ref && { ...ref.reps[0]!, label: ref.channel };
  }, [ghostTarget, bench.best, coach]);

  // レップを切り替えたら、ステップの始まりから見せる
  const { seek, toggle, step } = pb;
  useEffect(() => {
    seek(rep.events.strideStart);
  }, [rep.id, rep.events.strideStart, seek]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.key === " ") {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowLeft") step(e.shiftKey ? -10 : -1);
      else if (e.key === "ArrowRight") step(e.shiftKey ? 10 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, step]);

  const frame = rep.seq.frames[pb.frame]!;
  const phase = phaseAt(rep.phases, pb.frame);
  const rows = coach.evaluate(rep, session.camera, bench);
  const top = coach.findings(rep, session.camera, bench)[0];
  const curves = rep.rotation;
  // 投球の区間を通して同じ範囲で描く（座標の原点は、デモの合成データと手元の映像とで違う）
  const cam = useMemo(() => fitCamera(rep.seq.frames, 4), [rep]);
  const wrist = useMemo(() => speedSeries(rep.seq, "rWrist"), [rep]);
  const ghostWrist = useMemo(() => {
    if (!ghost) return undefined;
    const speeds = speedSeries(ghost.seq, "rWrist");
    return rep.seq.frames.map((_, i) => speeds[alignedFrame(rep, ghost, i)]!);
  }, [rep, ghost]);
  const elbow = useMemo(() => rep.seq.frames.map((f) => jointAngle(kp(f, "rShoulder"), kp(f, "rElbow"), kp(f, "rWrist"))), [rep]);
  const nearRelease = Math.abs(pb.frame - rep.events.release) <= 2;
  const nearPlant = Math.abs(pb.frame - rep.events.plant) <= 3;
  const markers = [
    { frame: rep.events.plant, label: "接地" },
    { frame: rep.events.release, label: "リリース" },
  ];

  return (
    <div className="space-y-5">

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          {/* 映像 */}
          <Card className="overflow-hidden" data-tour="studio-video">
            <div className="relative">
              <FieldScene
                className="block w-full"
                cam={cam}
                hud={
                  <Hud
                    tl={[repLabel(rep.index).toUpperCase(), `${CAMERA_LABEL[session.camera]} · ${rep.seq.fps} FPS`]}
                    tr={[PHASE_LABEL[phase], ghost ? `GHOST: ${ghost.label}` : ""]}
                    bl={[`${frame.t.toFixed(3)}s`, `FRAME ${String(pb.frame).padStart(3, "0")}`]}
                    br={[`${pb.rate}×`]}
                  />
                }
              >
                {ghost && <Skeleton frame={applyFit(ghost.seq.frames[alignedFrame(rep, ghost, pb.frame)]!, fitTo(rep, ghost))} variant="ghost" />}
                {layers.trail && <Trail frames={rep.seq.frames} joint="rWrist" from={rep.events.strideStart} to={Math.min(pb.frame, rep.events.followStart + 8)} />}
                {layers.skeleton && <Skeleton frame={frame} />}
                {layers.angles && (pb.frame >= rep.events.plant - 6 ? <AngleArc frame={frame} a="rShoulder" b="rElbow" c="rWrist" label="肘" /> : null)}
                {layers.angles && nearPlant && <AngleArc frame={frame} a="lHip" b="lKnee" c="lAnkle" label="膝" color="#5AC8FA" />}
                {nearRelease && (
                  <g>
                    <text x={1250} y={190} textAnchor="middle" fontSize={44} fill="#FF7A1A" fontFamily="var(--font-display)" fontWeight={600} letterSpacing={6} className="glow-pylon">
                      RELEASE
                    </text>
                  </g>
                )}
              </FieldScene>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
              <Toggle on={layers.skeleton} onChange={(v) => setLayers((l) => ({ ...l, skeleton: v }))}>
                骨格
              </Toggle>
              <Toggle on={layers.angles} onChange={(v) => setLayers((l) => ({ ...l, angles: v }))} tone="pylon">
                角度
              </Toggle>
              <Toggle on={layers.trail} onChange={(v) => setLayers((l) => ({ ...l, trail: v }))} tone="pylon">
                手首の軌跡
              </Toggle>
              <span className="mx-1 h-4 w-px bg-line" />
              <label className="flex items-center gap-2 text-xs text-muted">
                ゴースト
                <select value={ghostTarget} onChange={(e) => setGhostTarget(e.target.value)} className="rounded-md border border-line bg-panel px-2 py-1 text-xs text-text">
                  <option value="none">なし</option>
                  <option value="best">自己ベスト</option>
                  {sideRefs.map((r) => (
                    <option key={r.id} value={r.id}>
                      お手本：{r.channel}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </Card>

          {/* タイムラインと操作 */}
          <Card className="space-y-4 p-4" data-tour="studio-timeline">
            <PhaseBar phases={rep.phases} frame={pb.frame} total={rep.seq.frames.length} markers={markers} onSeek={pb.seek} />
            <div className="flex flex-wrap items-center gap-3 pt-3">
              <div className="flex items-center gap-1">
                <Button variant="ghost" onClick={() => pb.step(-1)} aria-label="1 フレーム戻る">
                  <IconPlayerSkipBack size={16} />
                </Button>
                <Button onClick={pb.toggle} aria-label={pb.playing ? "一時停止" : "再生"} className="w-10">
                  {pb.playing ? <IconPlayerPause size={16} /> : <IconPlayerPlay size={16} />}
                </Button>
                <Button variant="ghost" onClick={() => pb.step(1)} aria-label="1 フレーム進む">
                  <IconPlayerSkipForward size={16} />
                </Button>
              </div>
              <input type="range" min={0} max={rep.seq.frames.length - 1} step={1} value={pb.frame} onChange={(e) => pb.seek(+e.target.value)} className="min-w-40 flex-1" aria-label="再生位置" />
              <Segmented
                label="再生速度"
                size="sm"
                value={String(pb.rate)}
                onChange={(v) => pb.setRate(Number(v))}
                options={[
                  { value: "0.25", label: "0.25×" },
                  { value: "0.5", label: "0.5×" },
                  { value: "1", label: "1×" },
                ]}
              />
              <span className="hidden items-center gap-1 text-[11px] text-faint md:flex">
                <IconRepeat size={13} aria-hidden /> <Kbd>Space</Kbd> 再生 <Kbd>←</Kbd>
                <Kbd>→</Kbd> コマ送り
              </span>
            </div>
          </Card>

          {/* 同期グラフ */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <SectionTitle
                right={
                  curves.length >= 3 && (
                    <span className="flex gap-3 text-[11px] text-muted">
                      <span style={{ color: "#1f7a52" }}>■ 骨盤</span>
                      <span style={{ color: "#2EE59D" }}>■ 体幹</span>
                      <span style={{ color: "#FF7A1A" }}>■ 腕</span>
                    </span>
                  )
                }
              >
                キネマティックシーケンス（°/s）
              </SectionTitle>
              {curves.length >= 3 ? (
                <TimeChart
                  frame={pb.frame}
                  onSeek={pb.seek}
                  markers={markers}
                  series={[
                    { label: "骨盤", values: curves[0]!.values, color: "#1f7a52", width: 2.5 },
                    { label: "体幹", values: curves[1]!.values, color: "#2EE59D", width: 2.5 },
                    { label: "腕", values: curves[2]!.values, color: "#FF7A1A", width: 2.5 },
                  ]}
                />
              ) : (
                <p className="rounded-lg border border-line bg-white/[0.02] px-3 py-6 text-center text-xs text-muted">骨盤・体幹・腕の回転の速さは、横から撮った 2D の映像では測れません。3D の骨格を推定できるようにしてから測る予定です。</p>
              )}
              <p className="mt-2 text-xs text-muted">
                骨盤 → 体幹のピーク間隔 <span className="font-mono text-text">{formatMetric("sequenceGap", rep.metrics.sequenceGap)}</span>（お手本{" "}
                <span className="font-mono text-ice">{zones.sequenceGap ? `${Math.round(zones.sequenceGap.p25)}〜${Math.round(zones.sequenceGap.p75)} ms` : "—"}</span>）。{source === "demo" ? "デモでは回転の速さを合成しています（実際の映像では、3D の骨格を推定できるようにしてから測ります）。" : ""}
              </p>
            </Card>
            <Card className="p-4">
              <SectionTitle right={<span className="text-[11px] text-muted">{ghost ? `点線：${ghost.label}` : ""}</span>}>手首の速さ（m/s）と肘角度</SectionTitle>
              <TimeChart
                frame={pb.frame}
                onSeek={pb.seek}
                markers={markers}
                series={[
                  { label: "手首の速さ", values: wrist, color: "#FF7A1A", width: 2.5 },
                  ...(ghostWrist ? [{ label: "ゴースト", values: ghostWrist, color: "#5AC8FA", dashed: true }] : []),
                ]}
              />
              <div className="mt-2 flex items-center justify-between text-xs text-muted">
                <span>
                  現在の肘角度 <span className="font-mono text-pylon">{Math.round(elbow[pb.frame]!)}°</span>
                </span>
                <span>
                  ピーク <span className="font-mono text-text">{Math.max(...wrist).toFixed(1)} m/s</span>
                </span>
              </div>
            </Card>
          </div>
        </div>

        {/* 指標カード */}
        <aside className="space-y-3" data-tour="studio-metrics">
          <SectionTitle right={<span className="text-[11px] text-faint">押すと根拠のフレームへ</span>}>指標</SectionTitle>
          {rows.map((r) => {
            const def = METRIC_BY_KEY[r.key];
            const at = def.at === "range" ? rep.events.setStart : rep.events[def.at];
            const na = r.status === "na";
            return (
              <button
                key={r.key}
                type="button"
                disabled={na}
                onClick={() => {
                  pb.setPlaying(false);
                  pb.seek(at);
                }}
                className={cx("card block w-full p-3.5 text-left transition-colors", !na && "hover:border-line-strong hover:bg-raised", na && "opacity-70")}
                title={def.hint}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted">{def.label}</span>
                  <StatusIcon status={r.status} />
                </div>
                {na ? (
                  r.imprecise ? (
                    <>
                      <div className="mt-1 font-display text-2xl text-text/70">{formatMetric(r.key, r.value)}</div>
                      <p className="mt-1 text-[11px] leading-relaxed text-caution">{impreciseReason(r.key, r.uncertainty!, rep.seq.fps)}</p>
                    </>
                  ) : (
                    <p className="mt-1.5 text-xs leading-relaxed text-faint">{!isValidFor(def, session.camera) ? invalidReason(def, session.camera) : r.value === undefined ? "この投球では測れていません" : noZoneReason(def, rep.approach)}</p>
                  )
                ) : (
                  <>
                    <div className="mt-1 flex items-baseline justify-between gap-2">
                      <span className="font-display text-2xl">{formatMetric(r.key, r.value)}</span>
                      <span className="text-[11px] text-muted">
                        ベスト <span className="font-mono">{formatMetric(r.key, r.best)}</span>
                      </span>
                    </div>
                    <ZoneBar zone={r.zone} value={r.value} best={r.best} className="mt-2.5" />
                  </>
                )}
              </button>
            );
          })}
          <div className="flex items-center gap-3 px-1 pt-1 text-[11px] text-faint">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-pylon" /> 今回
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-0.5 bg-text/60" /> 自己ベスト
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-4 rounded-full bg-ice/40" /> お手本ゾーン
            </span>
          </div>
        </aside>
      </div>

      {top && (
        <Card className="flex flex-wrap items-start gap-4 p-5">
          <IconMessageCircle size={22} className="mt-0.5 text-turf" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted">AI コーチの一言</div>
            <p className="mt-1 font-medium">{top.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">{top.body}</p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => {
                pb.setPlaying(false);
                pb.seek(top.frame);
              }}
            >
              根拠のフレームへ
            </Button>
            <Link to={`/sessions/${session.id}/report`}>
              <Button variant="primary">レポート</Button>
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}

type View = "analysis" | "compare";

export function Studio() {
  const { session, rep, setRep } = useSessionRep();
  const [params, setParams] = useSearchParams();
  const view: View = params.get("view") === "compare" ? "compare" : "analysis";
  const setView = (v: View) =>
    setParams(
      (p) => {
        if (v === "compare") p.set("view", "compare");
        else p.delete("view");
        return p;
      },
      { replace: true },
    );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">分析スタジオ</h1>
          <Segmented
            label="スタジオの表示"
            value={view}
            onChange={setView}
            options={[
              { value: "analysis", label: "分析" },
              { value: "compare", label: "比較" },
            ]}
          />
          <Badge>
            {formatDate(session.date)} {session.title} · {CAMERA_LABEL[session.camera]}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setRep(Math.max(0, rep.index - 1))} disabled={rep.index === 0} aria-label="前のレップ">
            <IconChevronLeft size={16} />
          </Button>
          <span className="font-mono text-sm">
            {repLabel(rep.index)} / {session.reps.length}
          </span>
          <Button variant="ghost" onClick={() => setRep(Math.min(session.reps.length - 1, rep.index + 1))} disabled={rep.index === session.reps.length - 1} aria-label="次のレップ">
            <IconChevronRight size={16} />
          </Button>
        </div>
      </div>
      <PageGuide id="studio" sessionId={session.id} />
      {view === "compare" ? <CompareView key={rep.id} session={session} rep={rep} /> : <AnalysisView key={rep.id} session={session} rep={rep} />}
    </div>
  );
}
