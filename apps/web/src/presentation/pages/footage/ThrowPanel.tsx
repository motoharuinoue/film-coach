// 投球の解析：身長を入れて投球を見つけ、投球ごとのフェーズと QB 指標を出す。
// 手元のお手本があれば、その分布（お手本ゾーン）で「良好・注意・要改善」を判定する（M2-3）。

import { IconAlertTriangle, IconLoader2, IconRefresh, IconRulerMeasure, IconTarget } from "@tabler/icons-react";
import { useState } from "react";
import { CAMERA_LABEL, type CameraAngle } from "../../../domain/camera";
import { formatMetric, invalidReason, isValidFor, METRICS, MIN_SET_S, type MetricKey, unitSuffix } from "../../../domain/metrics";
import {
  APPROACH_LABEL,
  APPROACH_MODE_LABEL,
  HEIGHT_CM,
  isValidHeightCm,
  releaseFrame,
  SLOWMO_OPTIONS,
  spread,
  type ApproachMode,
  type ThrowAnalysis,
  type ThrowRep,
  type ThrowsRequest,
} from "../../../domain/throws";
import { impreciseReason, judgeMetrics, MIN_JUDGED_FOR_SCORE, noZoneReason, type ThrowJudgement } from "../../../application/judgeThrows";
import { EMPTY_ZONE_SET, evaluateMetric, zonesFor, type ZoneSet, type Zones } from "../../../domain/judgement";
import { PhaseBar, ZoneBar } from "../../components/charts";
import { Link } from "react-router";
import { Badge, Button, Card, DemoNote, SectionTitle, Segmented, StatusPill, cx } from "../../components/ui";

/** 投球を測れる角度。エンドゾーン・サイドラインからの試合映像は M4 で扱う */
const ANGLES: CameraAngle[] = ["side", "behind", "front"];

/** 測れる角度なのに値がないときの理由（映っていない区間・見つからなかったイベントからは測らない） */
const UNMEASURED: Partial<Record<MetricKey, string>> = {
  releaseTime: "ステップの始まりが映っていないか、ステップが見つからないため測っていません",
  strideRatio: "ステップが見つからないため測っていません",
  frontKnee: "ステップが見つからないため測っていません",
  headStability: `ステップの前の構えが映っている時間が短いため測っていません（${MIN_SET_S} 秒以上必要）`,
};

const APPROACH_MODES: ApproachMode[] = ["auto", "drop", "standing"];

function HeightForm({
  initial,
  initialCamera = "side",
  initialSlowmo = 1,
  initialApproach = "auto",
  busy,
  label,
  heightLabel = "身長（cm）",
  onSubmit,
}: {
  initial?: number;
  initialCamera?: CameraAngle;
  initialSlowmo?: number;
  initialApproach?: ApproachMode;
  busy: boolean;
  label: string;
  heightLabel?: string;
  onSubmit: (req: ThrowsRequest) => void;
}) {
  const [text, setText] = useState(initial ? String(initial) : "");
  const [camera, setCamera] = useState<CameraAngle>(initialCamera);
  const [slowmo, setSlowmo] = useState(String(initialSlowmo));
  const [approach, setApproach] = useState<ApproachMode>(initialApproach);
  const cm = Number(text);
  const ok = isValidHeightCm(cm);
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok && !busy) onSubmit({ heightCm: cm, camera, slowmo: Number(slowmo), approach });
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
      <div>
        <span className="mb-1 block text-xs text-muted">スロー再生</span>
        <Segmented label="スロー再生の倍率" size="sm" value={slowmo} onChange={setSlowmo} options={SLOWMO_OPTIONS.map((k) => ({ value: String(k), label: k === 1 ? "等速" : `${k} 倍` }))} />
      </div>
      <div>
        <span className="mb-1 block text-xs text-muted">投げ始め</span>
        <Segmented label="投げ始め" size="sm" value={approach} onChange={setApproach} options={APPROACH_MODES.map((m) => ({ value: m, label: APPROACH_MODE_LABEL[m] }))} />
      </div>
      <Button type="submit" variant="primary" disabled={!ok || busy}>
        {busy ? <IconLoader2 size={16} className="animate-spin" aria-hidden /> : <IconTarget size={16} aria-hidden />}
        {label}
      </Button>
      {text && !ok && (
        <span className="text-xs text-flag">
          {HEIGHT_CM.min}〜{HEIGHT_CM.max} cm の範囲で入れてください
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

/** 投げ始めと、その根拠（骨盤が下がった距離） */
function ApproachLine({ rep, analysis }: { rep: ThrowRep; analysis: ThrowAnalysis }) {
  const a = rep.approach;
  const how = analysis.approachMode === "auto" ? "骨格から見分けました" : "指定した投げ始めです";
  const why = !a
    ? "投げ始めを見分けられるようになる前に解析した結果です。計算し直すと見分けます"
    : a.kind === "unknown"
      ? a.dropM === null
        ? "横から撮った映像でないと、ドロップの有無を測れません"
        : "ステップの前の構えが映っていないため、見分けられませんでした"
      : a.dropM !== null
        ? `ステップの前に骨盤が ${a.dropM.toFixed(1)} m 下がっています（${how}）`
        : how;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <span>投げ始め</span>
      <Badge tone={a && a.kind !== "unknown" ? "ice" : undefined}>{APPROACH_LABEL[a?.kind ?? "unknown"]}</Badge>
      <span className="text-faint">{why}</span>
    </div>
  );
}

function MetricGrid({ analysis, rep, zones }: { analysis: ThrowAnalysis; rep: ThrowRep; zones: Zones }) {
  const measured = METRICS.filter((d) => rep.metrics[d.key] !== undefined);
  const unmeasured = METRICS.filter((d) => rep.metrics[d.key] === undefined);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {measured.map((d) => {
          const s = spread(analysis, d.key);
          const zone = zones[d.key];
          const ev = evaluateMetric(d.key, rep.metrics[d.key], undefined, zone, rep.uncertainty?.[d.key]);
          const status = ev.status;
          return (
            <div key={d.key} className={cx("rounded-xl border bg-white/[0.02] p-3", status === "flag" ? "border-flag/30" : status === "caution" ? "border-caution/25" : "border-line")}>
              <div className="flex items-start justify-between gap-2">
                <div className="text-[11px] text-muted">{d.label}</div>
                {zone && !ev.imprecise && <StatusPill status={status} className="shrink-0" />}
              </div>
              <div className="mt-1 font-display text-2xl leading-none">{formatMetric(d.key, rep.metrics[d.key])}</div>
              {ev.imprecise ? (
                <p className="mt-2 text-[10px] leading-relaxed text-caution">{impreciseReason(d.key, ev.uncertainty!, rep.sequence.fps)}</p>
              ) : zone ? (
                <div className="mt-2 space-y-1">
                  <ZoneBar zone={zone} value={rep.metrics[d.key]} />
                  <div className="font-mono text-[10px] text-ice">
                    お手本ゾーン {zone.p25.toFixed(d.digits)}〜{zone.p75.toFixed(d.digits)}
                    {unitSuffix(d.unit)}
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-[10px] text-faint">判定不可：{noZoneReason(d, rep.approach?.kind)}</p>
              )}
              <p className="mt-2 text-[11px] leading-relaxed text-faint">{d.hint}</p>
              {s && (
                <p className="mt-1 font-mono text-[11px] text-muted">
                  全 {s.n} 球：平均 {formatMetric(d.key, s.mean)}（{s.min.toFixed(d.digits)}〜{s.max.toFixed(d.digits)}）
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
              <span className="text-muted">{d.label}</span>：{!isValidFor(d, analysis.camera) ? invalidReason(d, analysis.camera) : UNMEASURED[d.key] ?? "まだ測っていません。骨盤と体幹の回転は、3D の骨格を推定できるようにしてから測る予定です"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ScoreLine({ judgement, refCount }: { judgement: ThrowJudgement; refCount: number }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white/[0.02] px-4 py-3">
      <div>
        <div className="text-[11px] text-muted">お手本との一致</div>
        <div className="font-display text-3xl leading-none text-turf">{judgement.score ?? "—"}</div>
      </div>
      <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-muted">
        {judgement.score !== undefined
          ? `お手本 ${refCount} 本の分布（重み付き）で、判定できた ${judgement.judged} 指標の点数の平均です。四分位の内側を満点にし、外れるほど下げます。`
          : `判定できた指標が ${judgement.judged} 個で、点数を出すには ${MIN_JUDGED_FOR_SCORE} 個以上必要です。同じ角度で撮ったお手本を増やしてください。`}
      </p>
    </div>
  );
}

export function ThrowPanel({
  analysis,
  heightCm,
  zoneSet = EMPTY_ZONE_SET,
  refCount = 0,
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
  /** 判定に使う、手元のお手本のゾーン一式 */
  zoneSet?: ZoneSet;
  /** 手元のお手本の数 */
  refCount?: number;
  /** YouTube から取り込んだお手本の映像か（身長はお手本の選手のもので、自分の身長としては保存しない） */
  forReference?: boolean;
  busy: boolean;
  error?: string;
  /** 再生中の映像のフレーム番号 */
  frame: number;
  fps: number;
  selected: number;
  onAnalyze: (req: ThrowsRequest) => void;
  onPick: (rep: ThrowRep) => void;
  onSeekFrame: (frame: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const rep = analysis?.reps.find((r) => r.index === selected) ?? analysis?.reps[0];
  // 投げ始めで意味が変わる指標は、投げ始めが同じお手本のゾーンで判定する
  const zones = zonesFor(zoneSet, rep?.approach?.kind);

  if (!analysis) {
    return (
      <Card className="space-y-4 p-5">
        <SectionTitle>投球の解析</SectionTitle>
        <p className="text-sm leading-relaxed text-muted">
          {forReference
            ? "追跡した骨格から投球を見つけ、1 球ずつフェーズと QB 指標を出します。お手本の選手の身長を入れてください（分からなければ 188 cm）。縮尺と cm 単位の指標に使います。"
            : "追跡した骨格から投球を見つけ、1 球ずつフェーズと QB 指標を出します。横から全身が映った映像が向いています。身長は縮尺と cm 単位の指標に使い、この端末の中にだけ保存します。"}
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
          <ApproachLine rep={rep} analysis={analysis} />
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
          {refCount > 0 && <ScoreLine judgement={judgeMetrics(rep.metrics, zones, rep.uncertainty)} refCount={refCount} />}
          <MetricGrid analysis={analysis} rep={rep} zones={zones} />
        </>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3 text-xs text-muted">
        <IconRulerMeasure size={15} aria-hidden />
        身長 <span className="font-mono text-text">{height} cm</span>・{CAMERA_LABEL[analysis.camera]}
        {analysis.slowmo > 1 && `・${analysis.slowmo} 倍のスロー再生`}で計算しました
        {!editing && (
          <button type="button" className="text-ice hover:underline" onClick={() => setEditing(true)}>
            <IconRefresh size={13} className="mr-0.5 inline" aria-hidden />
            条件を変えて計算し直す
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
          initialSlowmo={analysis.slowmo}
          initialApproach={analysis.approachMode}
          onSubmit={(req) => {
            onAnalyze(req);
            setEditing(false);
          }}
        />
      )}
      {error && <p className="text-xs text-flag">{error}</p>}
      {refCount === 0 && !forReference && (
        <DemoNote>
          お手本を登録すると、お手本の分布（重み付き）で「良好・注意・要改善」を判定します。
          <Link to="/references/search" className="ml-1 text-ice underline">
            お手本を探す
          </Link>
        </DemoNote>
      )}
    </Card>
  );
}
