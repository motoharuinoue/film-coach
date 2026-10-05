// M0 前半（基盤）のプレビュー。合成骨格の再生と、指標・重み付けの計算結果を確かめる画面。
// M0 後半で 8 画面のルーティングに置き換える。

import { IconPlayerPause, IconPlayerPlay } from "@tabler/icons-react";
import { alignedFrame, alignOffset } from "../domain/align";
import { formatMetric, METRIC_BY_KEY } from "../domain/metrics";
import { PHASE_LABEL, phaseAt } from "../domain/phases";
import { FieldScene, Hud, Skeleton, Trail } from "./components/scene";
import { Badge, Button, Card, SectionTitle, StatusPill } from "./components/ui";
import { usePlayback } from "./hooks/usePlayback";
import { useDefaultBenchmarks, useServices } from "./services";

export function App() {
  const { coach } = useServices();
  const bench = useDefaultBenchmarks();
  const { session, rep } = coach.focus();
  const best = bench.best;
  const pb = usePlayback(rep.seq.frames.length, rep.seq.fps, { autoplay: true, initialRate: 0.5 });
  const frame = rep.seq.frames[pb.frame]!;
  const phase = phaseAt(rep.phases, pb.frame);
  const rows = coach.evaluate(rep, session.camera, bench);

  return (
    <main className="bg-grid mx-auto min-h-screen max-w-6xl px-6 py-10">
      <div className="mb-6 flex items-center gap-3">
        <h1 className="font-display text-3xl">FILM COACH</h1>
        <Badge tone="ice">基盤プレビュー</Badge>
      </div>

      <Card className="overflow-hidden">
        <FieldScene
          className="block w-full"
          hud={<Hud tl={[`REP ${String(rep.index + 1).padStart(2, "0")}`, "SIDE · 60 FPS"]} tr={[PHASE_LABEL[phase]]} bl={[`${frame.t.toFixed(2)}s`]} />}
        >
          {best && <Skeleton frame={best.seq.frames[alignedFrame(rep, best, pb.frame)]!} variant="ghost" offset={alignOffset(rep, best)} />}
          <Trail frames={rep.seq.frames} joint="rWrist" from={rep.events.strideStart} to={pb.frame} />
          <Skeleton frame={frame} />
        </FieldScene>
        <div className="flex items-center gap-3 border-t border-line px-4 py-3">
          <Button onClick={pb.toggle} aria-label={pb.playing ? "一時停止" : "再生"}>
            {pb.playing ? <IconPlayerPause size={16} /> : <IconPlayerPlay size={16} />}
          </Button>
          <input type="range" min={0} max={rep.seq.frames.length - 1} value={pb.frame} onChange={(e) => pb.seek(+e.target.value)} className="flex-1" aria-label="再生位置" />
          <span className="font-mono text-xs text-muted">
            {pb.frame} / {rep.seq.frames.length - 1}
          </span>
        </div>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <SectionTitle>指標（自分 / 自己ベスト / お手本ゾーン）</SectionTitle>
          <table className="w-full text-sm">
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-line">
                  <td className="py-2">{METRIC_BY_KEY[r.key].short}</td>
                  <td className="py-2 text-right font-mono">{formatMetric(r.key, r.value)}</td>
                  <td className="py-2 text-right font-mono text-muted">{formatMetric(r.key, r.best)}</td>
                  <td className="py-2 text-right font-mono text-ice">{r.zone ? `${formatMetric(r.key, r.zone.p25)}〜${formatMetric(r.key, r.zone.p75)}` : "—"}</td>
                  <td className="py-2 pl-3 text-right">
                    <StatusPill status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="p-5">
          <SectionTitle>お手本の重み（P × C × Q × K × M、ステップ幅）</SectionTitle>
          <table className="w-full text-sm">
            <tbody>
              {coach.references().map((ref) => {
                const p = bench.weights.parts[ref.id]?.strideRatio;
                return (
                  <tr key={ref.id} className="border-t border-line">
                    <td className="py-2">{ref.channel}</td>
                    {(["P", "C", "Q", "K", "M"] as const).map((k) => (
                      <td key={k} className="py-2 text-right font-mono text-muted">
                        {p ? p[k].toFixed(2) : "—"}
                      </td>
                    ))}
                    <td className="py-2 text-right font-mono text-turf">{(bench.weights.overall[ref.id] ?? 0).toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted">選手・チャンネル・動画はすべて架空のデモデータです。</p>
        </Card>
      </div>
    </main>
  );
}
