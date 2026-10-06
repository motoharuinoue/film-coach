// 正解を付ける：① 接地・リリースの瞬間をコマ送りで選ぶ ② フレームごとに関節をクリックする。
// 正解が解析の結果に引っ張られないよう、解析の骨格と、解析で見つけた瞬間は見せない。

import { IconArrowBackUp, IconCheck, IconChevronLeft, IconChevronRight, IconEyeOff, IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import type { TrackBox } from "../../../domain/footage";
import {
  EVENT_HINT,
  EVENT_LABEL,
  LABEL_JOINTS,
  frameLabel,
  isFrameDone,
  isThrowingSide,
  jointLabel,
  nextJoint,
  withEvent,
  withPoint,
  withoutPoint,
  cropFor,
  type AnnotationInput,
  type Crop,
  type EvaluationTarget,
  type EvaluationThrow,
  type EventKey,
  type LabelJoint,
  type Point,
} from "../../../domain/evaluation";
import { Button, Card, Segmented, cx } from "../../components/ui";
import { useAnalyzer } from "../../state/analyzer";

export type Step = "events" | "joints";

const LOUPE = 160;
const ZOOM = 3;

/** 人の枠（追跡の結果）。拡大して見せる範囲を決めるだけに使い、骨格は見せない */
function useBoxes(videoId: string) {
  const { lib } = useAnalyzer();
  const [boxes, setBoxes] = useState<Map<number, TrackBox>>(new Map());
  useEffect(() => {
    let alive = true;
    void lib!
      .get(videoId)
      .then((f) => lib!.track(f))
      .then((t) => alive && setBoxes(new Map(t.frames.filter((f) => f.box).map((f) => [f.i, f.box!]))))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [lib, videoId]);
  return boxes;
}

/**
 * フレームの画像。crop の範囲（元の映像のピクセル）を拡大して見せ、クリックした位置を元の映像のピクセルで返す。
 * カーソルの近くは、さらに拡大して見せる
 */
function FrameView({
  src,
  width,
  height,
  crop,
  points,
  hand,
  current,
  onPick,
}: {
  src: string;
  width: number;
  height: number;
  crop: Crop;
  points?: Partial<Record<LabelJoint, Point | null>>;
  hand: EvaluationTarget["hand"];
  current?: LabelJoint;
  onPick?: (p: Point) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number; w: number; h: number }>();
  const [loaded, setLoaded] = useState<string>();
  const toVideo = (e: React.MouseEvent): Point | undefined => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return undefined;
    return [crop.x + ((e.clientX - r.left) / r.width) * crop.w, crop.y + ((e.clientY - r.top) / r.height) * crop.h];
  };
  // 拡大した範囲に対する、画像全体の大きさと位置（%）
  const imgStyle = { width: `${(width / crop.w) * 100}%`, height: `${(height / crop.h) * 100}%`, left: `${(-crop.x / crop.w) * 100}%`, top: `${(-crop.y / crop.h) * 100}%` };
  const ratio = crop.w / crop.h;
  return (
    <div
      ref={ref}
      className={cx("relative mx-auto overflow-hidden rounded-lg border border-line bg-black", onPick && "cursor-crosshair")}
      style={{ aspectRatio: `${crop.w} / ${crop.h}`, width: `min(100%, calc(66vh * ${ratio}))` }}
      onMouseMove={(e) => {
        const r = ref.current!.getBoundingClientRect();
        setHover({ x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height });
      }}
      onMouseLeave={() => setHover(undefined)}
      onClick={(e) => {
        const p = toVideo(e);
        if (p && onPick) onPick([Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
      }}
    >
      <img src={src} alt="" className="absolute max-w-none select-none" style={imgStyle} draggable={false} onLoad={() => setLoaded(src)} />
      {loaded !== src && <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs text-muted">読み込んでいます…</div>}
      {points && (
        <svg viewBox={`${crop.x} ${crop.y} ${crop.w} ${crop.h}`} className="pointer-events-none absolute inset-0 h-full w-full">
          {LABEL_JOINTS.map((j) => {
            const p = points[j];
            if (!p) return null;
            const color = j === "nose" ? "#e8edf2" : isThrowingSide(j, hand) ? "#ff7a1a" : "#5ac8fa";
            return (
              <g key={j}>
                <circle cx={p[0]} cy={p[1]} r={crop.w / 70} fill="none" stroke={color} strokeWidth={crop.w / 300} />
                <circle cx={p[0]} cy={p[1]} r={crop.w / 400} fill={color} />
              </g>
            );
          })}
        </svg>
      )}
      {onPick && hover && (
        <div
          className="pointer-events-none absolute rounded-full border-2 border-white/80 shadow-2xl"
          style={{
            width: LOUPE,
            height: LOUPE,
            left: Math.min(hover.w - LOUPE - 8, hover.x + 24),
            top: Math.max(8, hover.y - LOUPE - 24),
            backgroundImage: `url("${src}")`,
            backgroundRepeat: "no-repeat",
            // 画像全体を、拡大した範囲の表示倍率 × ZOOM で敷き、カーソルの位置が中心に来るようにずらす
            backgroundSize: `${(width / crop.w) * hover.w * ZOOM}px ${(height / crop.h) * hover.h * ZOOM}px`,
            backgroundPosition: `${LOUPE / 2 - ((crop.x / crop.w) * hover.w + hover.x) * ZOOM}px ${LOUPE / 2 - ((crop.y / crop.h) * hover.h + hover.y) * ZOOM}px`,
          }}
          aria-hidden
        >
          <span className="absolute top-1/2 left-1/2 h-px w-5 -translate-x-1/2 bg-pylon" />
          <span className="absolute top-1/2 left-1/2 h-5 w-px -translate-y-1/2 bg-pylon" />
          {current && <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-ink/90 px-1.5 text-[11px] text-pylon">{jointLabel(current, hand)}</span>}
        </div>
      )}
    </div>
  );
}

/** 近くのフレームを先に読んでおき、コマ送りを滑らかにする */
function usePreload(urls: string[]) {
  const key = urls.join("|");
  useEffect(() => {
    for (const u of key.split("|")) new Image().src = u;
  }, [key]);
}

function EventsStep({ target, t, draft, onChange }: { target: EvaluationTarget; t: EvaluationThrow; draft: AnnotationInput; onChange: (a: AnnotationInput) => void }) {
  const { lib } = useAnalyzer();
  const v = target.video;
  const label = draft.throws.find((x) => x.rep === t.rep);
  const lo = Math.max(0, t.start - 15);
  const hi = Math.min(v.frameCount - 1, t.end);
  // 解析で見つけた瞬間から始めると正解が引っ張られるので、区間の中ほどから始める
  const [f, setF] = useState(label?.release ?? Math.round((t.start + t.end) / 2));
  const go = (n: number) => setF(Math.min(hi, Math.max(lo, n)));
  usePreload([1, 2, 3, -1, -2].map((d) => lib!.frameAt(v.id, Math.min(hi, Math.max(lo, f + d)))));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // スライダーにフォーカスがあるときは、スライダー自身が動かす
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        setF((x) => Math.min(hi, Math.max(lo, x + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 5 : 1))));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lo, hi]);
  const set = (key: EventKey) => onChange(withEvent(draft, t.rep, key, f));
  const boxes = useBoxes(v.id);
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-3">
        <FrameView src={lib!.frameAt(v.id, f)} width={v.width} height={v.height} crop={cropFor(boxes, f, lo, hi, v.width, v.height)} hand={target.hand} />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={() => go(f - 5)} aria-label="5 フレーム戻る">
            −5
          </Button>
          <Button variant="ghost" onClick={() => go(f - 1)} aria-label="1 フレーム戻る">
            <IconChevronLeft size={16} aria-hidden />
          </Button>
          <input type="range" min={lo} max={hi} value={f} onChange={(e) => go(Number(e.target.value))} className="min-w-40 flex-1 accent-pylon" aria-label="フレーム" />
          <Button variant="ghost" onClick={() => go(f + 1)} aria-label="1 フレーム進む">
            <IconChevronRight size={16} aria-hidden />
          </Button>
          <Button variant="ghost" onClick={() => go(f + 5)} aria-label="5 フレーム進む">
            +5
          </Button>
          <span className="font-mono text-xs text-muted">
            フレーム {f}（{(f / v.fps).toFixed(2)} 秒）
          </span>
        </div>
        <p className="text-[11px] text-faint">← → で 1 フレーム、Shift を押しながらで 5 フレーム動きます。</p>
      </div>
      <div className="space-y-3">
        {(["plant", "release"] as const).map((key) => {
          const at = label?.[key] ?? null;
          return (
            <div key={key} className="rounded-lg border border-line p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">{EVENT_LABEL[key]}</div>
                {at !== null ? (
                  <button type="button" onClick={() => go(at)} className="font-mono text-xs text-turf hover:underline">
                    フレーム {at} へ
                  </button>
                ) : (
                  <span className="text-xs text-muted">未設定</span>
                )}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted">{EVENT_HINT[key]}</p>
              <Button variant={at === f ? "ghost" : "primary"} className="mt-2 w-full justify-center" onClick={() => set(key)} disabled={at === f}>
                {at === f ? (
                  <>
                    <IconCheck size={15} aria-hidden /> このフレームにしました
                  </>
                ) : (
                  `このフレームを${EVENT_LABEL[key]}にする`
                )}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function JointsStep({ target, t, draft, onChange }: { target: EvaluationTarget; t: EvaluationThrow; draft: AnnotationInput; onChange: (a: AnnotationInput) => void }) {
  const { lib } = useAnalyzer();
  const v = target.video;
  const frames = t.frames;
  const [f, setF] = useState(() => frames.find((x) => !isFrameDone(frameLabel(draft, x))) ?? frames[0]!);
  const [picked, setPicked] = useState<LabelJoint>();
  const label = frameLabel(draft, f);
  const current = picked ?? nextJoint(label);
  const done = isFrameDone(label);
  usePreload(frames.map((x) => lib!.frameAt(v.id, x)));
  const boxes = useBoxes(v.id);
  const crop = cropFor(boxes, f, Math.max(0, t.start - 15), Math.min(v.frameCount - 1, t.end), v.width, v.height);

  const place = (p: Point | null) => {
    if (!current) return;
    onChange(withPoint(draft, f, current, p));
    setPicked(undefined);
  };
  const undo = () => {
    // 次に付ける関節の 1 つ前（すべて付けたなら最後の関節）を消す
    const i = current ? LABEL_JOINTS.indexOf(current) : LABEL_JOINTS.length;
    const prev = LABEL_JOINTS.slice(0, i).reverse().find((j) => label && j in label.points);
    if (prev) {
      onChange(withoutPoint(draft, f, prev));
      setPicked(undefined);
    }
  };
  const latest = useRef({ place, undo });
  latest.current = { place, undo };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "n" || e.key === "N") latest.current.place(null);
      else if (e.key === "Backspace") {
        e.preventDefault();
        latest.current.undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {frames.map((x) => {
            const ok = isFrameDone(frameLabel(draft, x));
            return (
              <button
                key={x}
                type="button"
                onClick={() => {
                  setF(x);
                  setPicked(undefined);
                }}
                className={cx("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs", x === f ? "border-pylon/60 bg-pylon/10 text-pylon" : ok ? "border-turf/30 text-turf" : "border-line text-muted hover:text-text")}
              >
                {ok && <IconCheck size={12} aria-hidden />}
                {x}
              </button>
            );
          })}
          <span className="ml-auto text-[11px] text-muted">
            {frames.filter((x) => isFrameDone(frameLabel(draft, x))).length} / {frames.length} 枚
          </span>
        </div>
        <FrameView src={lib!.frameAt(v.id, f)} width={v.width} height={v.height} crop={crop} points={label?.points} hand={target.hand} current={current} onPick={current ? place : undefined} />
        <p className="text-[11px] text-faint">
          関節の中心をクリックします。N で「見えない」、Backspace で 1 つ戻ります。<span className="text-pylon">橙</span>は投げる腕と後ろ足、<span className="text-ice">青</span>は反対の腕と前足です。
        </p>
      </div>
      <div className="space-y-3">
        <div className={cx("rounded-lg border p-3", done ? "border-turf/40 bg-turf/[0.05]" : "border-pylon/40 bg-pylon/[0.06]")}>
          {done ? (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-sm text-turf">
                <IconCheck size={16} aria-hidden /> このフレームは付け終わりました
              </div>
              {frames.every((x) => isFrameDone(frameLabel(draft, x))) ? (
                <p className="text-[11px] leading-relaxed text-muted">この投球のフレームは、すべて付け終わりました。「閉じる」で一覧に戻り、次の映像に進めます。</p>
              ) : (
                <Button variant="primary" className="w-full justify-center" onClick={() => setF(frames.find((x) => !isFrameDone(frameLabel(draft, x)))!)}>
                  次のフレームへ
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="text-[11px] text-muted">次にクリックする関節</div>
              <div className="mt-0.5 text-base font-semibold text-pylon">{current ? jointLabel(current, target.hand) : "—"}</div>
              <div className="mt-2 flex gap-2">
                <Button variant="ghost" onClick={() => place(null)}>
                  <IconEyeOff size={15} aria-hidden /> 見えない
                </Button>
                <Button variant="ghost" onClick={undo}>
                  <IconArrowBackUp size={15} aria-hidden /> 1 つ戻る
                </Button>
              </div>
            </>
          )}
        </div>
        <ul className="space-y-0.5 text-xs">
          {LABEL_JOINTS.map((j) => {
            const p = label?.points[j];
            const state = !label || !(j in label.points) ? "未" : p === null ? "見えない" : "済";
            return (
              <li key={j}>
                <button
                  type="button"
                  onClick={() => setPicked(j)}
                  className={cx("flex w-full items-center justify-between rounded px-2 py-1 text-left hover:bg-white/5", j === current && "bg-pylon/10 text-pylon")}
                  title="押すと、この関節を付け直せます"
                >
                  <span>{jointLabel(j, target.hand)}</span>
                  <span className={cx("text-[11px]", state === "済" ? "text-turf" : state === "見えない" ? "text-caution" : "text-faint")}>{state}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export function Annotator({
  target,
  t,
  step,
  setStep,
  draft,
  onChange,
  onClose,
  saving,
}: {
  target: EvaluationTarget;
  t: EvaluationThrow;
  step: Step;
  setStep: (s: Step) => void;
  draft: AnnotationInput;
  onChange: (a: AnnotationInput) => void;
  onClose: () => void;
  saving: boolean;
}) {
  return (
    <Card className="space-y-4 p-5" data-tour="evaluation-annotator">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">
            {target.video.name} · 投球 {t.rep}
          </div>
          <div className="text-[11px] text-muted">{saving ? "保存しています…" : "付けた正解は、その都度保存します"}</div>
        </div>
        <Segmented
          label="正解を付ける段階"
          size="sm"
          value={step}
          onChange={setStep}
          options={[
            { value: "events", label: "① 瞬間" },
            { value: "joints", label: "② 関節" },
          ]}
        />
        <Button variant="ghost" className="ml-auto" onClick={onClose}>
          <IconX size={15} aria-hidden /> 閉じる
        </Button>
      </div>
      {step === "events" ? <EventsStep key={`${target.video.id}-${t.rep}`} target={target} t={t} draft={draft} onChange={onChange} /> : <JointsStep key={`${target.video.id}-${t.rep}`} target={target} t={t} draft={draft} onChange={onChange} />}
    </Card>
  );
}
