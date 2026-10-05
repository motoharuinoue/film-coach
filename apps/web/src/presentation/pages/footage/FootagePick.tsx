import { IconCheck, IconCrosshair, IconLoader2, IconTarget } from "@tabler/icons-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { overallProgress, trackFootage } from "../../../application/footage";
import type { TrackingProgress } from "../../../application/ports";
import type { Footage } from "../../../domain/footage";
import { Button, Card, PageHeader, SectionTitle, cx } from "../../components/ui";
import { PageGuide } from "../../guide/PageGuide";
import { useAnalyzer } from "../../state/analyzer";
import { AnalyzerGate } from "./AnalyzerGate";

const STAGE = { detect: "全員の検出と追跡", pose: "本人の骨格推定" } as Record<string, string>;

function Picker() {
  const { id = "" } = useParams();
  const { lib } = useAnalyzer();
  const navigate = useNavigate();
  const [footage, setFootage] = useState<Footage>();
  const [error, setError] = useState<string>();
  const [t, setT] = useState(0);
  const [shownT, setShownT] = useState(0);
  const [point, setPoint] = useState<{ x: number; y: number; t: number }>();
  const [label, setLabel] = useState("");
  const [progress, setProgress] = useState<TrackingProgress>();
  const [running, setRunning] = useState(false);
  const img = useRef<HTMLImageElement>(null);

  useEffect(() => {
    lib
      ?.get(id)
      .then((f) => {
        setFootage(f);
        setLabel(f.label);
        setT(Math.min(5, f.info.duration / 2));
        setShownT(Math.min(5, f.info.duration / 2));
      })
      .catch((e: Error) => setError(e.message));
  }, [lib, id]);

  // スライダーを動かしている間は、フレームの取得を少し待つ
  useEffect(() => {
    const h = setTimeout(() => setShownT(t), 150);
    return () => clearTimeout(h);
  }, [t]);

  if (error) return <p className="text-sm text-flag">{error}</p>;
  if (!footage || !lib) return <p className="text-sm text-muted">読み込んでいます…</p>;
  if (!footage.mediaRetained) {
    return (
      <Card className="p-6 text-sm text-muted">
        この映像は YouTube から取り込んだ区間で、解析のあとに元の動画を消しています（ADR-0005）。本人を選び直すときは、もう一度取り込んでください。
      </Card>
    );
  }

  const { width: W, height: H, duration } = footage.info;
  const pick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (running) return;
    const r = e.currentTarget.getBoundingClientRect();
    setPoint({ x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H, t: shownT });
  };
  const start = async () => {
    if (!point) return;
    setRunning(true);
    setError(undefined);
    try {
      await trackFootage(lib, footage.id, { ...point, label }, setProgress);
      navigate(`/footage/${footage.id}`);
    } catch (e) {
      setError((e as Error).message);
      setRunning(false);
    }
  };
  const k = W / 1920;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-3">
        <Card className="overflow-hidden">
          <div className="relative bg-black" style={{ aspectRatio: `${W} / ${H}` }}>
            <img
              ref={img}
              src={lib.frameUrl(footage, shownT) ?? undefined}
              alt={`${shownT.toFixed(1)} 秒のフレーム`}
              onClick={pick}
              className={cx("absolute inset-0 h-full w-full select-none", running ? "cursor-wait" : "cursor-crosshair")}
              draggable={false}
            />
            {point && Math.abs(point.t - shownT) < 0.05 && (
              <svg viewBox={`0 0 ${W} ${H}`} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
                <circle cx={point.x} cy={point.y} r={46 * k} fill="none" stroke="#FF7A1A" strokeWidth={4 * k} className="glow-pylon" />
                <circle cx={point.x} cy={point.y} r={6 * k} fill="#FF7A1A" />
                <line x1={point.x - 70 * k} x2={point.x - 52 * k} y1={point.y} y2={point.y} stroke="#FF7A1A" strokeWidth={3 * k} />
                <line x1={point.x + 52 * k} x2={point.x + 70 * k} y1={point.y} y2={point.y} stroke="#FF7A1A" strokeWidth={3 * k} />
                {label && (
                  <text x={point.x + 56 * k} y={point.y - 52 * k} fill="#FF7A1A" fontSize={30 * k} fontFamily="var(--font-display)" fontWeight={600}>
                    {label}
                  </text>
                )}
              </svg>
            )}
          </div>
        </Card>
        <div className="flex items-center gap-3">
          <input type="range" min={0} max={duration} step={0.1} value={t} onChange={(e) => setT(Number(e.target.value))} className="flex-1" aria-label="フレームの時刻" disabled={running} />
          <span className="w-20 text-right font-mono text-xs text-muted">{t.toFixed(1)}s</span>
        </div>
        {point && Math.abs(point.t - shownT) >= 0.05 && (
          <p className="text-xs text-muted">
            印は {point.t.toFixed(1)} 秒のフレームに付いています。
            <button type="button" className="ml-1 text-ice hover:underline" onClick={() => setT(point.t)}>
              その時刻に戻る
            </button>
          </p>
        )}
      </div>

      <aside className="space-y-4">
        <Card className="space-y-4 p-5">
          <SectionTitle>追いかける人</SectionTitle>
          <div className="flex items-center gap-3 text-sm">
            <IconCrosshair size={18} className={point ? "text-pylon" : "text-faint"} aria-hidden />
            {point ? (
              <span>
                {point.t.toFixed(1)} 秒の <span className="font-mono">({Math.round(point.x)}, {Math.round(point.y)})</span>
              </span>
            ) : (
              <span className="text-muted">映像の中の本人を押してください</span>
            )}
          </div>
          <div>
            <label htmlFor="target-label" className="mb-1 block text-xs text-muted">
              名前（枠に表示）
            </label>
            <input id="target-label" value={label} onChange={(e) => setLabel(e.target.value.slice(0, 20))} placeholder="#5" disabled={running} className="w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm focus:border-ice/50 focus:outline-none" />
          </div>
          <Button variant="primary" className="w-full py-2.5" disabled={!point || running} onClick={start}>
            {running ? <IconLoader2 size={16} className="animate-spin" aria-hidden /> : <IconTarget size={16} aria-hidden />}
            {running ? "追跡しています…" : "この人を追う"}
          </Button>
          {error && <p className="text-xs leading-relaxed text-flag">{error}</p>}
          <p className="text-[11px] leading-relaxed text-faint">体の真ん中（胸のあたり）を押すと確実です。人の陰に隠れた短い間は、前後から補間してつなぎます。</p>
        </Card>

        {running && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="space-y-3 p-5">
              <SectionTitle right={<span className="font-mono text-xs text-turf">{Math.round(overallProgress(progress) * 100)}%</span>}>解析サービスで処理中</SectionTitle>
              {(["detect", "pose"] as const).map((s) => {
                const p = progress?.stage === s ? progress.done / progress.total : progress?.stage === "pose" && s === "detect" ? 1 : 0;
                return (
                  <div key={s}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className={p >= 1 ? "text-turf" : "text-text/85"}>
                        {p >= 1 && <IconCheck size={12} className="mr-1 inline" aria-hidden />}
                        {STAGE[s]}
                      </span>
                      <span className="font-mono text-muted">{Math.round(p * 100)}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                      <motion.div className="h-full rounded-full bg-turf" animate={{ width: `${p * 100}%` }} transition={{ duration: 0.3 }} />
                    </div>
                  </div>
                );
              })}
              <p className="text-[11px] text-faint">20 秒の映像で 1〜2 分ほどかかります。この画面を閉じても、解析は続きます。</p>
            </Card>
          </motion.div>
        )}
      </aside>
    </div>
  );
}

export function FootagePick() {
  return (
    <div className="space-y-6">
      <PageHeader title="① 取り込む：本人を選ぶ" sub="大勢が映る映像から、追いかける本人を 1 回押して選びます" />
      <PageGuide id="pick" />
      <AnalyzerGate>
        <Picker />
      </AnalyzerGate>
    </div>
  );
}
