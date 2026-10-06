// お手本と重ねる：自分の投球に、手元のお手本の骨格を重ねて動かす（M2-5）。
// 時間はフェーズの区切りで、体格は身長で、位置は接地時の後ろ足で合わせる（domain/align.ts）。
// 比べる相手は、投げ始めが同じで重みの高いお手本を自動で選び、ほかのお手本にも切り替えられる。

import { IconArrowRight, IconPlayerPause, IconPlayerPlay } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { compareMetrics, ghostCandidates, type GhostCandidate } from "../../../application/ghost";
import { alignedFrame, anchors, applyFit, fitTo, type Alignable } from "../../../domain/align";
import { zonesFor, type ZoneSet } from "../../../domain/judgement";
import { formatMetric, METRIC_BY_KEY, unitSuffix } from "../../../domain/metrics";
import { PHASE_LABEL, phaseAt } from "../../../domain/phases";
import { APPROACH_LABEL, isApproachGroup, type ThrowRep } from "../../../domain/throws";
import { PhaseBar } from "../../components/charts";
import { fitCamera } from "../../components/camera";
import { FieldScene, Hud, Skeleton } from "../../components/scene";
import { Button, Card, SectionTitle, Segmented, StatusIcon, cx } from "../../components/ui";
import { usePlayback } from "../../hooks/usePlayback";
import type { LibraryView } from "../../state/library";

type Mode = "overlay" | "side";
const RATES = ["0.1", "0.25", "0.5", "1"] as const;

function why(c: GhostCandidate, approach: ThrowRep["approach"], picked: boolean) {
  if (picked) return "選んだお手本と重ねています。";
  const kind = approach?.kind;
  if (c.sameApproach && isApproachGroup(kind)) return `投げ始めが同じ（${APPROACH_LABEL[kind]}）お手本のうち、重みがいちばん高いものを選びました。`;
  if (isApproachGroup(kind)) return `投げ始めが同じ（${APPROACH_LABEL[kind]}）お手本がないので、重みがいちばん高いものを選びました。`;
  return "投げ始めが分からないので、重みがいちばん高いお手本を選びました。";
}

export function ReferenceGhost({ rep, view, zoneSet, onSeekSelf }: { rep: ThrowRep; view: LibraryView; zoneSet: ZoneSet; onSeekSelf?: (frame: number) => void }) {
  const approach = rep.approach?.kind;
  const candidates = useMemo(() => ghostCandidates(view.refs, view.weights.overall, view.manual, approach), [view, approach]);
  const [pickedId, setPickedId] = useState<string>();
  const [mode, setMode] = useState<Mode>("overlay");
  const current = candidates.find((c) => c.ref.id === pickedId) ?? candidates[0];
  const self: Alignable = { seq: rep.sequence, events: rep.events };
  const pb = usePlayback(rep.sequence.frames.length, rep.sequence.fps, { autoplay: true, initialRate: 0.25 });

  const other: Alignable | undefined = current && { seq: current.rep.seq, events: current.rep.events };
  const fit = other && fitTo(self, other);
  const cam = useMemo(() => {
    const frames = [...rep.sequence.frames];
    if (other && fit) for (let i = 0; i < rep.sequence.frames.length; i++) frames.push(applyFit(other.seq.frames[alignedFrame(self, other, i)]!, fit));
    return fitCamera(frames, 4);
    // 自分の投球と、重ねるお手本が変わったときだけ計算し直す（self・other・fit はこの 2 つから決まる）
  }, [rep, current]);

  if (!current || !other || !fit) {
    return (
      <Card className="space-y-2 p-5">
        <SectionTitle>お手本と重ねる</SectionTitle>
        <p className="text-sm text-muted">横から撮ったお手本がないため、重ねられません。お手本ライブラリに、横から全身が映ったお手本を登録してください。</p>
      </Card>
    );
  }

  const otherIndex = alignedFrame(self, other, pb.frame);
  const selfFrame = rep.sequence.frames[pb.frame]!;
  const ghostFrame = applyFit(other.seq.frames[otherIndex]!, fit);
  const phase = PHASE_LABEL[phaseAt(rep.phases, pb.frame)];
  const title = current.ref.title.length > 28 ? `${current.ref.title.slice(0, 28)}…` : current.ref.title;
  const clip = current.rep.clip;
  const rows = compareMetrics(rep.metrics, current.rep.metrics, zonesFor(zoneSet, approach), rep.uncertainty);
  const scene = (children: React.ReactNode, tl: string[]) => (
    <FieldScene cam={cam} className="block w-full" hud={<Hud tl={tl} tr={[phase]} bl={[`${selfFrame.t.toFixed(2)}s`]} />}>
      {children}
    </FieldScene>
  );

  return (
    <Card className="space-y-4 p-5">
      <SectionTitle
        right={
          <select value={current.ref.id} onChange={(e) => setPickedId(e.target.value)} aria-label="重ねるお手本" className="max-w-72 rounded-lg border border-line bg-panel px-2 py-1 text-xs">
            {candidates.map((c) => (
              <option key={c.ref.id} value={c.ref.id}>
                {c.ref.title.slice(0, 32)}（{APPROACH_LABEL[c.rep.approach ?? "unknown"]}・重み {c.weight.toFixed(2)}）
              </option>
            ))}
          </select>
        }
      >
        お手本と重ねる
      </SectionTitle>
      <p className="text-xs leading-relaxed text-muted">
        {why(current, rep.approach, pickedId !== undefined)}
        お手本の骨格を、身長（{Math.round(other.seq.heightM * 100)} cm）が自分（{Math.round(self.seq.heightM * 100)} cm）と同じになるように{fit.scale < 1 ? "縮小し" : "拡大し"}、接地のときの後ろ足の位置で重ねています。時間は、フェーズの区切り（{anchors(self, other).length} か所）で合わせています。
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="重ね方"
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: "overlay", label: "重ねる" },
            { value: "side", label: "並べる" },
          ]}
        />
        <Segmented label="再生速度" size="sm" value={String(pb.rate) as (typeof RATES)[number]} onChange={(v) => pb.setRate(Number(v))} options={RATES.map((r) => ({ value: r, label: `${r}×` }))} />
        <span className="ml-auto flex items-center gap-3 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-full bg-turf" /> 自分
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-full bg-ice" /> お手本
          </span>
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-line">
        {mode === "overlay" ? (
          scene(
            <>
              <Skeleton frame={ghostFrame} cam={cam} variant="ref" />
              <Skeleton frame={selfFrame} cam={cam} />
            </>,
            [`自分 #${rep.index}`, `お手本：${title}`],
          )
        ) : (
          <div className="grid gap-px bg-line md:grid-cols-2">
            {scene(<Skeleton frame={selfFrame} cam={cam} />, [`自分 #${rep.index}`])}
            {scene(<Skeleton frame={ghostFrame} cam={cam} variant="ref" />, [`お手本：${title}`])}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <PhaseBar
          phases={rep.phases}
          frame={pb.frame}
          total={rep.sequence.frames.length}
          markers={[
            { frame: rep.events.plant, label: "接地" },
            { frame: rep.events.release, label: "リリース" },
          ]}
          onSeek={pb.seek}
        />
        <div className="flex flex-wrap items-center gap-3 pt-3">
          <Button onClick={pb.toggle} aria-label={pb.playing ? "一時停止" : "再生"} className="w-10">
            {pb.playing ? <IconPlayerPause size={16} /> : <IconPlayerPlay size={16} />}
          </Button>
          <input type="range" min={0} max={rep.sequence.frames.length - 1} value={pb.frame} onChange={(e) => pb.seek(+e.target.value)} className="min-w-40 flex-1" aria-label="再生位置" />
          {onSeekSelf && (
            <button type="button" className="text-xs text-ice hover:underline" onClick={() => onSeekSelf(pb.frame)}>
              自分の映像でこの瞬間を見る
            </button>
          )}
          {clip && (
            <Link to={`/footage/${clip.videoId}?t=${((clip.frame0 + otherIndex) / clip.videoFps).toFixed(2)}`} className="inline-flex items-center gap-1 text-xs text-ice hover:underline">
              お手本の映像でこの瞬間を見る <IconArrowRight size={13} aria-hidden />
            </Link>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] text-muted">
              <th className="py-2 font-normal">指標</th>
              <th className="py-2 text-right font-normal">自分</th>
              <th className="py-2 text-right font-normal">このお手本</th>
              <th className="py-2 text-right font-normal">差</th>
              <th className="py-2 pl-4 font-normal">お手本ゾーンでの判定</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = METRIC_BY_KEY[r.key];
              return (
                <tr key={r.key} className="border-b border-line/60">
                  <td className="py-2">{d.label}</td>
                  <td className="py-2 text-right font-mono text-turf">{formatMetric(r.key, r.self)}</td>
                  <td className="py-2 text-right font-mono text-ice">{formatMetric(r.key, r.other)}</td>
                  <td className={cx("py-2 text-right font-mono", r.diff === undefined ? "text-faint" : "text-text")}>{r.diff === undefined ? "—" : `${r.diff > 0 ? "+" : ""}${r.diff.toFixed(d.digits)}${unitSuffix(d.unit)}`}</td>
                  <td className="py-2 pl-4">{r.self !== undefined && <StatusIcon status={r.status} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] leading-relaxed text-faint">差の大小は良し悪しを表しません。お手本 1 本との違いを見るためのもので、判定は、自分の値がお手本ゾーン（重み付きの分布）に入るかどうかで決めています。</p>
    </Card>
  );
}
