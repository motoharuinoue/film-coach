import { IconPlayerPause, IconPlayerPlay } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { alignedFrame, applyFit, fitTo } from "../../../domain/align";
import type { AnalyzedRep, Session } from "../../../domain/entities";
import { formatMetric, METRIC_BY_KEY } from "../../../domain/metrics";
import { PHASE_LABEL, phaseAt } from "../../../domain/phases";
import { PhaseBar } from "../../components/charts";
import { FieldScene, Hud, Skeleton } from "../../components/scene";
import { Badge, Button, Card, SectionTitle, Segmented, StatusIcon, cx } from "../../components/ui";
import { usePlayback } from "../../hooks/usePlayback";
import { useCoach } from "../../state/benchmarks";
import { formatDate, repLabel } from "../../state/session";

type Mode = "overlay" | "side";

/** 分析スタジオの「比較」表示：自己ベストかお手本と、重ねて・並べて比べる */
export function CompareView({ session, rep }: { session: Session; rep: AnalyzedRep }) {
  const { coach, bench } = useCoach();
  const [mode, setMode] = useState<Mode>("overlay");
  const sideRefs = coach.references().filter((r) => r.stats.camera === "side");
  const [targetId, setTargetId] = useState<string>("best");
  const pb = usePlayback(rep.seq.frames.length, rep.seq.fps, { autoplay: true, initialRate: 0.25 });

  const target = useMemo<(AnalyzedRep & { label: string }) | undefined>(() => {
    if (targetId === "best") return bench.best && { ...bench.best, label: `自己ベスト ${formatDate(bench.best.date)} ${repLabel(bench.best.index)}` };
    const ref = coach.reference(targetId);
    return ref && { ...ref.reps[0]!, label: ref.channel };
  }, [targetId, bench.best, coach]);

  const self = rep.seq.frames[pb.frame]!;
  const other = target ? applyFit(target.seq.frames[alignedFrame(rep, target, pb.frame)]!, fitTo(rep, target)) : undefined;
  const evals = coach.evaluate(rep, session.camera, bench);
  const phase = PHASE_LABEL[phaseAt(rep.phases, pb.frame)];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">フェーズの区切りで時間を合わせ、身長をそろえ、接地時の後ろ足で位置を合わせて比べます</p>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label="比較の表示"
            value={mode}
            onChange={setMode}
            options={[
              { value: "overlay", label: "重ねる" },
              { value: "side", label: "並べる" },
            ]}
          />
          <select value={targetId} onChange={(e) => setTargetId(e.target.value)} aria-label="比べる相手" className="rounded-lg border border-line bg-panel px-3 py-1.5 text-sm">
            <option value="best">自己ベスト</option>
            {sideRefs.map((r) => (
              <option key={r.id} value={r.id}>
                お手本：{r.channel}
              </option>
            ))}
          </select>
        </div>
      </div>

      {mode === "overlay" ? (
        <Card className="overflow-hidden">
          <FieldScene className="block w-full" hud={<Hud tl={[`今回 ${repLabel(rep.index)}`, target ? `比較：${target.label}` : ""]} tr={[phase]} bl={[`${self.t.toFixed(3)}s`]} />}>
            {other && <Skeleton frame={other} variant="ref" />}
            <Skeleton frame={self} />
          </FieldScene>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="overflow-hidden">
            <FieldScene className="block w-full" hud={<Hud tl={[`今回 ${repLabel(rep.index)}`]} tr={[phase]} />}>
              <Skeleton frame={self} />
            </FieldScene>
          </Card>
          <Card className="overflow-hidden">
            <FieldScene className="block w-full" hud={<Hud tl={[target?.label ?? "—"]} tr={[phase]} />}>
              {other && <Skeleton frame={other} variant="ref" />}
            </FieldScene>
          </Card>
        </div>
      )}

      <Card className="space-y-4 p-4">
        <PhaseBar phases={rep.phases} frame={pb.frame} total={rep.seq.frames.length} markers={[{ frame: rep.events.release, label: "リリース" }]} onSeek={pb.seek} />
        <div className="flex items-center gap-3 pt-3">
          <Button onClick={pb.toggle} aria-label={pb.playing ? "一時停止" : "再生"} className="w-10">
            {pb.playing ? <IconPlayerPause size={16} /> : <IconPlayerPlay size={16} />}
          </Button>
          <input type="range" min={0} max={rep.seq.frames.length - 1} value={pb.frame} onChange={(e) => pb.seek(+e.target.value)} className="flex-1" aria-label="再生位置" />
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-4 rounded-full bg-turf" /> 今回
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-4 rounded-full bg-ice" /> 比較相手
            </span>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle right={target && <Badge tone="ice">{target.label}</Badge>}>指標の差</SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-2 font-normal">指標</th>
                <th className="py-2 text-right font-normal">今回</th>
                <th className="py-2 text-right font-normal">比較相手</th>
                <th className="py-2 text-right font-normal">差</th>
                <th className="py-2 pl-4 font-normal">判定</th>
              </tr>
            </thead>
            <tbody>
              {evals.map((e) => {
                const def = METRIC_BY_KEY[e.key];
                const o = target?.metrics[e.key];
                const diff = e.value !== undefined && o !== undefined ? e.value - o : undefined;
                return (
                  <tr key={e.key} className="border-t border-line">
                    <td className="py-2.5">{def.label}</td>
                    <td className="py-2.5 text-right font-mono">{formatMetric(e.key, e.value)}</td>
                    <td className="py-2.5 text-right font-mono text-ice">{formatMetric(e.key, o)}</td>
                    <td className={cx("py-2.5 text-right font-mono", diff === undefined ? "text-faint" : Math.abs(diff) < 10 ** -def.digits ? "text-muted" : "text-text")}>
                      {diff === undefined ? "—" : `${diff > 0 ? "+" : ""}${diff.toFixed(def.digits)}${def.unit}`}
                    </td>
                    <td className="py-2.5 pl-4">
                      <StatusIcon status={e.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
