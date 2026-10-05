// 投球の解析：身長を入れて投球を見つけ、投球ごとのフェーズと QB 指標を出す。
// 判定（良好・要改善）は、お手本の分布ができる M2 で出す。いまは値と、その意味を示す。

import { IconAlertTriangle, IconLoader2, IconRefresh, IconRulerMeasure, IconTarget } from "@tabler/icons-react";
import { useState } from "react";
import { CAMERA_LABEL, type CameraAngle } from "../../../domain/camera";
import { formatMetric, invalidReason, isValidFor, METRICS } from "../../../domain/metrics";
import { HEIGHT_CM, isValidHeightCm, releaseFrame, spread, type ThrowAnalysis, type ThrowRep } from "../../../domain/throws";
import { PhaseBar } from "../../components/charts";
import { Badge, Button, Card, DemoNote, SectionTitle, Segmented, cx } from "../../components/ui";

/** 投球を測れる角度。エンドゾーン・サイドラインからの試合映像は M4 で扱う */
const ANGLES: CameraAngle[] = ["side", "behind", "front"];

function HeightForm({
  initial,
  initialCamera = "side",
  busy,
  label,
  heightLabel = "身長（cm）",
  onSubmit,
}: {
  initial?: number;
  initialCamera?: CameraAngle;
  busy: boolean;
  label: string;
  heightLabel?: string;
  onSubmit: (cm: number, camera: CameraAngle) => void;
}) {
  const [text, setText] = useState(initial ? String(initial) : "");
  const [camera, setCamera] = useState<CameraAngle>(initialCamera);
  const cm = Number(text);
  const ok = isValidHeightCm(cm);
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok && !busy) onSubmit(cm, camera);
      }}
    >
      <div>
        <label htmlFor="height-cm" className="mb-1 block text-xs text-muted">
          {heightLabel}
        </label>
        <input
          id="height-cm"
          type="number"
          inputMode="numeric"
          min={HEIGHT_CM.min}
          max={HEIGHT_CM.max}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="180"
          disabled={busy}
          className="w-28 rounded-lg border border-line bg-ink px-3 py-2 font-mono text-sm focus:border-ice/50 focus:outline-none"
        />
      </div>
      <div>
        <span className="mb-1 block text-xs text-muted">撮った角度</span>
        <Segmented label="撮った角度" size="sm" value={camera} onChange={setCamera} options={ANGLES.map((a) => ({ value: a, label: CAMERA_LABEL[a] }))} />
      </div>
      <Button type="submit" variant="primary" disabled={!ok || busy}>
        {busy ? <IconLoader2 size={16} className="animate-spin" aria-hidden /> : <IconTarget size={16} aria-hidden />}
        {label}
      </Button>
      {text && !ok && (
        <span className="text-xs text-flag">
          {HEIGHT_CM.min}〜{HEIGHT_CM.max} cm で入れてください
        </span>
      )}
    </form>
  );
}

function RepPicker({ analysis, selected, fps, onPick }: { analysis: ThrowAnalysis; selected: number; fps: number; onPick: (rep: ThrowRep) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="投球">
      {analysis.reps.map((r) => (
        <button
          key={r.index}
          type="button"
          role="radio"
          aria-checked={r.index === selected}
          onClick={() => onPick(r)}
          className={cx(
            "rounded-lg border px-3 py-1.5 text-left text-xs transition-colors",
            r.index === selected ? "border-pylon/60 bg-pylon/10 text-text" : "border-line text-muted hover:border-white/20 hover:text-text",
          )}
        >
          <span className="font-display text-sm font-semibold">#{r.index}</span>
          <span className="ml-2 font-mono">リリース {(releaseFrame(r) / fps).toFixed(2)}s</span>
        </button>
      ))}
    </div>
  );
}

function MetricGrid({ analysis, rep }: { analysis: ThrowAnalysis; rep: ThrowRep }) {
  const measured = METRICS.filter((d) => rep.metrics[d.key] !== undefined);
  const unmeasured = METRICS.filter((d) => rep.metrics[d.key] === undefined);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {measured.map((d) => {
          const s = spread(analysis, d.key);
          return (
            <div key={d.key} className="rounded-xl border border-line bg-white/[0.02] p-3">
              <div className="text-[11px] text-muted">{d.label}</div>
              <div className="mt-1 font-display text-2xl leading-none">{formatMetric(d.key, rep.metrics[d.key])}</div>
              <p className="mt-2 text-[11px] leading-relaxed text-faint">{d.hint}</p>
              {s && (
                <p className="mt-1 font-mono text-[11px] text-muted">
                  全 {s.n} 本：平均 {formatMetric(d.key, s.mean)}（{s.min.toFixed(d.digits)}〜{s.max.toFixed(d.digits)}）
                </p>
              )}
            </div>
          );
        })}
      </div>
      {unmeasured.length > 0 && (
        <ul className="space-y-1 text-[11px] text-faint">
          {unmeasured.map((d) => (
            <li key={d.key}>
              <span className="text-muted">{d.label}</span>：{isValidFor(d, analysis.camera) ? "まだ測っていません（骨盤と体幹の回転は、3D の骨格（M5）で測ります）" : invalidReason(d, analysis.camera)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ThrowPanel({
  analysis,
  heightCm,
  forReference = false,
  busy,
  error,
  frame,
  fps,
  selected,
  onAnalyze,
  onPick,
  onSeekFrame,
}: {
  analysis?: ThrowAnalysis;
  heightCm?: number;
  /** YouTube から取り込んだお手本の映像か（身長はお手本の選手のもので、自分の身長としては保存しない） */
  forReference?: boolean;
  busy: boolean;
  error?: string;
  /** 再生中の映像のフレーム番号 */
  frame: number;
  fps: number;
  selected: number;
  onAnalyze: (cm: number, camera: CameraAngle) => void;
  onPick: (rep: ThrowRep) => void;
  onSeekFrame: (frame: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const rep = analysis?.reps.find((r) => r.index === selected) ?? analysis?.reps[0];

  if (!analysis) {
    return (
      <Card className="space-y-4 p-5">
        <SectionTitle>投球の解析</SectionTitle>
        <p className="text-sm leading-relaxed text-muted">
          {forReference
            ? "追跡した骨格から投球を見つけ、1 球ずつフェーズと QB 指標を出します。お手本の選手の身長を入れてください（分からなければ 188 cm）。縮尺と cm の指標に使います。"
            : "追跡した骨格から投球を見つけ、1 球ずつフェーズと QB 指標を出します。横から全身が映った映像が向いています。身長は縮尺と cm の指標に使い、この端末の中にだけ保存します。"}
        </p>
        <HeightForm initial={heightCm} busy={busy} label="投球を見つける" heightLabel={forReference ? "お手本の選手の身長（cm）" : undefined} onSubmit={onAnalyze} />
        {error && <p className="text-xs text-flag">{error}</p>}
      </Card>
    );
  }

  const height = Math.round(analysis.heightM * 100);
  return (
    <Card className="space-y-4 p-5">
      <SectionTitle
        right={
          <span className="flex gap-1.5">
            <Badge tone="ice">{analysis.hand === "right" ? "右投げ" : "左投げ"}</Badge>
            <Badge>{CAMERA_LABEL[analysis.camera]}</Badge>
          </span>
        }
      >
        投球 {analysis.reps.length} 球
      </SectionTitle>

      {analysis.warnings.map((w) => (
        <div key={w} className="flex gap-2 rounded-lg border border-caution/30 bg-caution/[0.05] px-3 py-2 text-xs leading-relaxed text-caution">
          <IconAlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
          {w}
        </div>
      ))}

      {rep && (
        <>
          <RepPicker analysis={analysis} selected={rep.index} fps={fps} onPick={onPick} />
          <div className="pt-1 pb-5">
            <PhaseBar
              phases={rep.phases}
              frame={Math.min(rep.end - rep.start, Math.max(0, frame - rep.start))}
              total={rep.end - rep.start + 1}
              markers={[
                { frame: rep.events.plant, label: "接地" },
                { frame: rep.events.release, label: "リリース" },
              ]}
              onSeek={(f) => onSeekFrame(rep.start + f)}
            />
          </div>
          <MetricGrid analysis={analysis} rep={rep} />
        </>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3 text-xs text-muted">
        <IconRulerMeasure size={15} aria-hidden />
        身長 <span className="font-mono text-text">{height} cm</span> で計算しました
        {!editing && (
          <button type="button" className="text-ice hover:underline" onClick={() => setEditing(true)}>
            <IconRefresh size={13} className="mr-0.5 inline" aria-hidden />
            変えて計算し直す
          </button>
        )}
      </div>
      {editing && (
        <HeightForm
          initial={heightCm ?? height}
          busy={busy}
          label="計算し直す"
          heightLabel={forReference ? "お手本の選手の身長（cm）" : undefined}
          initialCamera={analysis.camera}
          onSubmit={(cm, camera) => {
            onAnalyze(cm, camera);
            setEditing(false);
          }}
        />
      )}
      {error && <p className="text-xs text-flag">{error}</p>}
      <DemoNote>お手本との比較と判定（良好・要改善）は、お手本ライブラリ（M2）でお手本の分布ができたら出します。</DemoNote>
    </Card>
  );
}
