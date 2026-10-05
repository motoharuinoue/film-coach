// 自分の映像の部品：骨格の重ね表示、追跡のタイムライン、動画・YouTube のプレイヤー、フォーカス表示。

import { IconPlayerPause, IconPlayerPlay } from "@tabler/icons-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { crossesCut, focusWindow, frameAt, type TargetTrack, type TrackFrame } from "../../domain/footage";
import { BONES } from "../../domain/pose";
import { Button, Segmented, cx } from "./ui";

const TURF = "#2EE59D";
const PYLON = "#FF7A1A";
const CAUTION = "#FFC24B";

/** 表示上の 1px が、元の動画の何ピクセルにあたるか（線の太さと文字の大きさを、表示の大きさに合わせるため） */
function usePxToSource(width: number) {
  const ref = useRef<SVGSVGElement>(null);
  const [f, setF] = useState(width / 960);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && e.contentRect.width > 0 && setF(width / e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return { ref, f };
}

/** 元の動画のピクセルを座標にした SVG。動画と同じ縦横比の枠に重ねると位置が合う */
export function TrackOverlay({ frame, width, height, label, showBox = true, showSkeleton = true, zoom = 1 }: { frame?: TrackFrame; width: number; height: number; label?: string; showBox?: boolean; showSkeleton?: boolean; zoom?: number }) {
  const { ref, f: base } = usePxToSource(width);
  // フォーカス表示で拡大しているぶんは、線や文字を細く・小さくして見た目の大きさを保つ
  const f = base / zoom;
  return (
    <svg ref={ref} viewBox={`0 0 ${width} ${height}`} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
      {frame?.box && showBox && (
        <g>
          <rect
            x={frame.box.x1}
            y={frame.box.y1}
            width={frame.box.x2 - frame.box.x1}
            height={frame.box.y2 - frame.box.y1}
            rx={4 * f}
            fill="none"
            stroke={frame.interpolated ? CAUTION : PYLON}
            strokeWidth={2.5 * f}
            strokeDasharray={frame.interpolated ? `${6 * f} ${5 * f}` : undefined}
            className="glow-pylon"
          />
          {label && (
            <text x={frame.box.x1} y={frame.box.y1 - 6 * f} fill={frame.interpolated ? CAUTION : PYLON} fontSize={15 * f} fontFamily="var(--font-display)" fontWeight={600}>
              {label}
              {frame.interpolated ? "（補間）" : ""}
            </text>
          )}
        </g>
      )}
      {frame?.kp && showSkeleton && (
        <g className="glow-turf" strokeLinecap="round">
          {BONES.map(({ a, b, side }) => {
            const p = frame.kp![a]!;
            const q = frame.kp![b]!;
            if (p.c < 0.3 || q.c < 0.3) return null;
            return <line key={`${a}-${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={TURF} strokeWidth={(side === "far" ? 2 : 2.75) * f} strokeOpacity={side === "far" ? 0.6 : 1} />;
          })}
          {frame.kp.slice(5).map((p, i) => (p.c < 0.3 ? null : <circle key={i} cx={p.x} cy={p.y} r={2.5 * f} fill="#07090D" stroke={TURF} strokeWidth={1.25 * f} />))}
        </g>
      )}
    </svg>
  );
}

/** 帯に印を付ける投球の区間（映像のフレーム番号） */
export type ThrowMark = { index: number; start: number; end: number; release: number };

/** 追跡の状況：枠があるフレーム（緑）、補間したフレーム（黄）、見失ったフレーム（灰）。投球の区間とリリースに印を付ける */
export function TrackTimeline({ track, t, onSeek, throws = [] }: { track: TargetTrack; t: number; onSeek: (t: number) => void; throws?: ThrowMark[] }) {
  const n = track.frames.length;
  const duration = n / track.video.fps;
  return (
    <div
      className="relative h-6 cursor-pointer overflow-hidden rounded-md bg-white/5"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onSeek(((e.clientX - r.left) / r.width) * duration);
      }}
      role="slider"
      aria-label="追跡の状況と再生位置"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(t)}
      tabIndex={0}
    >
      <svg viewBox={`0 0 ${n} 1`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
        {track.frames.map((f) => (
          <rect key={f.i} x={f.i} y={0} width={1.02} height={1} fill={!f.box ? "rgba(255,255,255,0.06)" : f.interpolated ? CAUTION : TURF} fillOpacity={f.box ? 0.55 : 1} />
        ))}
      </svg>
      {track.cuts.map((c) => (
        <div key={c} className="absolute inset-y-0 w-px bg-ice" style={{ left: `${(c / n) * 100}%` }} title={`場面の切り替わり ${(c / track.video.fps).toFixed(2)} 秒`} />
      ))}
      {throws.map((m) => (
        <div key={m.index} className="pointer-events-none absolute inset-y-0" style={{ left: `${(m.start / n) * 100}%`, width: `${((m.end - m.start + 1) / n) * 100}%` }}>
          <div className="absolute inset-0 rounded-sm bg-white/10 ring-1 ring-white/30 ring-inset" />
          <div className="absolute inset-y-0 w-px bg-white" style={{ left: `${((m.release - m.start) / (m.end - m.start + 1)) * 100}%` }} title={`#${m.index} のリリース ${(m.release / track.video.fps).toFixed(2)} 秒`} />
        </div>
      ))}
      <div className="absolute inset-y-0 w-0.5 bg-pylon glow-pylon" style={{ left: `${(t / duration) * 100}%` }} />
    </div>
  );
}

/** フォーカス表示：対象選手を中心に拡大する。中心と倍率はなめらかに追いかける（場面が切り替わったら追いかけ直す） */
function useFocusTransform(frame: TrackFrame | undefined, track: TargetTrack, enabled: boolean) {
  const state = useRef<{ cx: number; cy: number; scale: number; i: number } | null>(null);
  const { width: W, height: H } = track.video;
  if (!enabled) {
    state.current = null;
    return { style: { transform: "none" }, scale: 1 };
  }
  if (frame && state.current && crossesCut(track.cuts, state.current.i, frame.i)) state.current = null;
  if (frame?.box) {
    const target = { ...focusWindow(frame.box, W, H), i: frame.i };
    const s = state.current;
    const a = 0.18;
    state.current = s ? { cx: s.cx + a * (target.cx - s.cx), cy: s.cy + a * (target.cy - s.cy), scale: s.scale + a * (target.scale - s.scale), i: frame.i } : target;
  }
  const f = state.current ?? { cx: W / 2, cy: H / 2, scale: 1 };
  // 枠の幅を 100% としたときの移動量（%）
  const tx = (0.5 - (f.cx / W) * f.scale) * 100;
  const ty = (0.5 - (f.cy / H) * f.scale) * 100;
  return { style: { transform: `translate(${tx}%, ${ty}%) scale(${f.scale})`, transformOrigin: "0 0" }, scale: f.scale };
}

function Stage({ track, frame, label, layers, badge, children }: { track: TargetTrack; frame?: TrackFrame; label?: string; layers: { box: boolean; skeleton: boolean; focus: boolean }; badge?: ReactNode; children: ReactNode }) {
  const { style, scale } = useFocusTransform(frame, track, layers.focus);
  return (
    <div className="relative w-full overflow-hidden rounded-xl bg-black" style={{ aspectRatio: `${track.video.width} / ${track.video.height}` }}>
      {badge && <div className="pointer-events-none absolute top-3 left-3 z-10">{badge}</div>}
      <div className="absolute inset-0" style={style}>
        {children}
        <TrackOverlay frame={frame} width={track.video.width} height={track.video.height} label={label} showBox={layers.box} showSkeleton={layers.skeleton} zoom={Math.sqrt(scale)} />
      </div>
    </div>
  );
}

export type Layers = { box: boolean; skeleton: boolean; focus: boolean };

function Transport({ playing, onToggle, t, duration, onSeek, rate, onRate }: { playing: boolean; onToggle: () => void; t: number; duration: number; onSeek: (t: number) => void; rate: number; onRate: (r: number) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={onToggle} aria-label={playing ? "一時停止" : "再生"} className="w-10">
        {playing ? <IconPlayerPause size={16} /> : <IconPlayerPlay size={16} />}
      </Button>
      <input type="range" min={0} max={duration} step={0.01} value={Math.min(t, duration)} onChange={(e) => onSeek(Number(e.target.value))} className="min-w-40 flex-1" aria-label="再生位置" />
      <span className="w-24 text-right font-mono text-xs text-muted">
        {t.toFixed(2)} / {duration.toFixed(1)}s
      </span>
      <Segmented
        label="再生速度"
        size="sm"
        value={String(rate)}
        onChange={(v) => onRate(Number(v))}
        options={[
          { value: "0.25", label: "0.25×" },
          { value: "0.5", label: "0.5×" },
          { value: "1", label: "1×" },
        ]}
      />
    </div>
  );
}

/** 手元に残した元の動画を再生し、フレームごとに骨格を重ねる */
/** 外から再生位置を指定する。key を変えるたびに、その時刻へ移って止める */
export type SeekRequest = { t: number; key: number };

type PlayerExtras = { onTime?: (t: number) => void; seekTo?: SeekRequest; throws?: ThrowMark[]; badge?: ReactNode };

export function VideoFootagePlayer({ src, track, label, layers, onTime, seekTo, throws, badge }: { src: string; track: TargetTrack; label?: string; layers: Layers } & PlayerExtras) {
  const video = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(0.5);
  const duration = track.frames.length / track.video.fps;
  const onTimeRef = useRef(onTime);
  onTimeRef.current = onTime;

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.playbackRate = rate;
  }, [rate]);

  // requestVideoFrameCallback で、表示されたフレームの時刻に合わせて骨格を描く
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let id = 0;
    const hasRvfc = "requestVideoFrameCallback" in v;
    const tick = () => {
      setT(v.currentTime);
      onTimeRef.current?.(v.currentTime);
      id = hasRvfc ? v.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
    };
    id = hasRvfc ? v.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
    return () => (hasRvfc ? v.cancelVideoFrameCallback(id) : cancelAnimationFrame(id));
  }, []);

  const seek = (s: number) => {
    if (video.current) video.current.currentTime = s;
    setT(s);
  };
  useEffect(() => {
    if (!seekTo || !video.current) return;
    video.current.pause();
    video.current.currentTime = seekTo.t;
    setT(seekTo.t);
  }, [seekTo]);
  const frame = frameAt(track, t);

  return (
    <div className="space-y-3">
      <Stage track={track} frame={frame} label={label} layers={layers} badge={badge}>
        <video
          ref={video}
          src={src}
          className="absolute inset-0 h-full w-full"
          playsInline
          muted
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onSeeked={() => setT(video.current?.currentTime ?? 0)}
        />
      </Stage>
      <Transport playing={playing} onToggle={() => (video.current?.paused ? video.current.play() : video.current?.pause())} t={t} duration={duration} onSeek={seek} rate={rate} onRate={setRate} />
      <TrackTimeline track={track} t={t} onSeek={seek} throws={throws} />
    </div>
  );
}

// ---- YouTube（元の動画は消しているので、公式の埋め込みプレイヤーに重ねる。ADR-0005） ----

type YTPlayer = {
  getCurrentTime(): number;
  seekTo(s: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  setPlaybackRate(r: number): void;
  getPlayerState(): number;
  destroy(): void;
};
type YTNamespace = { Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer };

let ytApi: Promise<YTNamespace> | undefined;
function loadYouTubeApi(): Promise<YTNamespace> {
  const w = window as unknown as { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void };
  if (w.YT?.Player) return Promise.resolve(w.YT);
  ytApi ??= new Promise((resolve) => {
    w.onYouTubeIframeAPIReady = () => resolve(w.YT!);
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  });
  return ytApi;
}

/** YouTube の埋め込みプレイヤー。追跡結果の時刻は区間の始まりを 0 とする */
export function YouTubeFootagePlayer({ videoId, start, end, track, label, layers, onTime, seekTo, throws, badge }: { videoId: string; start: number; end: number; track: TargetTrack; label?: string; layers: Layers } & PlayerExtras) {
  const host = useRef<HTMLDivElement>(null);
  const onTimeRef = useRef(onTime);
  onTimeRef.current = onTime;
  const player = useRef<YTPlayer | null>(null);
  const pending = useRef<number | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(0.5);
  const duration = end - start;

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    void loadYouTubeApi().then((YT) => {
      if (cancelled || !host.current) return;
      const el = document.createElement("div");
      host.current.appendChild(el);
      player.current = new YT.Player(el, {
        videoId,
        host: "https://www.youtube-nocookie.com",
        playerVars: { start, end, rel: 0, controls: 0, modestbranding: 1, playsinline: 1, mute: 1 },
        events: {
          onReady: () => {
            player.current?.setPlaybackRate(rate);
            if (pending.current !== null) {
              player.current?.seekTo(start + pending.current, true);
              pending.current = null;
            }
          },
          onStateChange: (e: { data: number }) => setPlaying(e.data === 1),
        },
      });
      const tick = () => {
        const p = player.current;
        if (p?.getCurrentTime) {
          const now = Math.max(0, p.getCurrentTime() - start);
          setT(now);
          onTimeRef.current?.(now);
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      player.current?.destroy();
      player.current = null;
    };
    // 再生速度（rate）は onReady でだけ使い、変わってもプレイヤーを作り直さない
  }, [videoId, start, end]);

  const seek = (s: number) => {
    player.current?.seekTo(start + s, true);
    setT(s);
  };
  useEffect(() => {
    if (!seekTo) return;
    // プレイヤーの準備ができる前なら、準備ができたときに移る
    if (!player.current?.seekTo) pending.current = seekTo.t;
    player.current?.pauseVideo?.();
    player.current?.seekTo?.(start + seekTo.t, true);
    setT(seekTo.t);
  }, [seekTo, start]);

  return (
    <div className="space-y-3">
      <Stage track={track} frame={frameAt(track, t)} label={label} layers={layers} badge={badge}>
        <div ref={host} className={cx("absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full")} />
      </Stage>
      <Transport
        playing={playing}
        onToggle={() => (playing ? player.current?.pauseVideo() : player.current?.playVideo())}
        t={t}
        duration={duration}
        onSeek={seek}
        rate={rate}
        onRate={(r) => {
          setRate(r);
          player.current?.setPlaybackRate(r);
        }}
      />
      <TrackTimeline track={track} t={t} onSeek={seek} throws={throws} />
    </div>
  );
}
