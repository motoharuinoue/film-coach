import { createContext, useContext, useId, type ReactNode } from "react";
import { BONES, headCenter, jointAngle, kp, type KeypointName, type PoseFrame, type Vec2 } from "../../domain/pose";
import { fitCamera } from "./camera";

// ワールド座標（m）→ SVG 座標（1600×900）
export type Camera = { x0: number; x1: number; y0: number; y1: number };
export const W = 1600;
export const H = 900;
export const DEFAULT_CAM: Camera = { x0: -2.9, x1: 1.1, y0: -0.15, y1: 2.1 };

export function project(cam: Camera, p: Vec2) {
  return { x: ((p.x - cam.x0) / (cam.x1 - cam.x0)) * W, y: ((cam.y1 - p.y) / (cam.y1 - cam.y0)) * H };
}

export const scale = (cam: Camera, m: number) => (m / (cam.x1 - cam.x0)) * W;

/** FieldScene の中の骨格・軌跡・角度は、cam を渡さなければシーンと同じ範囲で描く */
const SceneCamera = createContext<Camera>(DEFAULT_CAM);
const useCamera = (cam: Camera | undefined) => {
  const scene = useContext(SceneCamera);
  return cam ?? scene;
};

/** 横から見たフィールド。奥行きのあるヤードラインとスタジアムの光で雰囲気を出す */
export function FieldScene({ cam = DEFAULT_CAM, children, className, hud }: { cam?: Camera; children?: ReactNode; className?: string; hud?: ReactNode }) {
  const id = useId().replace(/:/g, "");
  const ground = project(cam, { x: 0, y: 0 }).y;
  const far = ground - 70;
  // 1 ヤード（0.914m）ごとの線。5 ヤードごとに太く
  const lines: { x: number; major: boolean; yd: number }[] = [];
  for (let yd = -6; yd <= 6; yd++) {
    const wx = 0.5 + yd * 0.9144;
    if (wx < cam.x0 - 1 || wx > cam.x1 + 1) continue;
    lines.push({ x: project(cam, { x: wx, y: 0 }).x, major: yd % 5 === 0, yd });
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} role="img" aria-label="骨格オーバーレイ付きの投球映像">
      <defs>
        <linearGradient id={`sky-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0d141e" />
          <stop offset="1" stopColor="#070a0f" />
        </linearGradient>
        <linearGradient id={`turf-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0c2219" />
          <stop offset="1" stopColor="#081610" />
        </linearGradient>
        <radialGradient id={`vig-${id}`} cx="0.5" cy="0.45" r="0.75">
          <stop offset="0.55" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.65" />
        </radialGradient>
        <radialGradient id={`light-${id}`}>
          <stop offset="0" stopColor="#cfe8ff" stopOpacity="0.5" />
          <stop offset="1" stopColor="#cfe8ff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#sky-${id})`} />
      {[180, 520, 1090, 1420].map((x, i) => (
        <circle key={x} cx={x} cy={60 + (i % 2) * 24} r={110} fill={`url(#light-${id})`} opacity={0.35} />
      ))}
      {/* スタンドの帯 */}
      <rect x={0} y={far - 160} width={W} height={160} fill="#0a0f16" opacity={0.7} />
      {Array.from({ length: 40 }, (_, i) => (
        <rect key={i} x={i * 40 + 6} y={far - 150 + (i % 3) * 18} width={22} height={4} rx={2} fill="#1a2533" opacity={0.6} />
      ))}
      <polygon points={`0,${far} ${W},${far} ${W},${H} 0,${H}`} fill={`url(#turf-${id})`} />
      {lines.map((l) => (
        <line key={l.yd} x1={l.x + 40} y1={far} x2={l.x - 50} y2={H} stroke="#e8f5ee" strokeOpacity={l.major ? 0.22 : 0.07} strokeWidth={l.major ? 5 : 2} />
      ))}
      <line x1={0} y1={ground} x2={W} y2={ground} stroke="#ffffff" strokeOpacity={0.05} strokeWidth={2} />
      <SceneCamera.Provider value={cam}>{children}</SceneCamera.Provider>
      <rect width={W} height={H} fill={`url(#vig-${id})`} pointerEvents="none" />
      {hud}
    </svg>
  );
}

type Variant = "self" | "ghost" | "ref";

const STYLE: Record<Variant, { color: string; glow: string; opacity: number }> = {
  self: { color: "#2EE59D", glow: "glow-turf", opacity: 1 },
  ghost: { color: "#5AC8FA", glow: "glow-ice", opacity: 0.5 },
  ref: { color: "#5AC8FA", glow: "glow-ice", opacity: 1 },
};

export function Skeleton({ frame, cam: camProp, variant = "self", offset = { x: 0, y: 0 }, joints = true, width = 1 }: { frame: PoseFrame; cam?: Camera; variant?: Variant; offset?: Vec2; joints?: boolean; width?: number }) {
  const cam = useCamera(camProp);
  const s = STYLE[variant];
  const P = (p: Vec2) => project(cam, { x: p.x + offset.x, y: p.y + offset.y });
  const head = P(headCenter(frame));
  const r = scale(cam, 0.105);
  const sw = scale(cam, 0.034) * width;
  return (
    <g className={s.glow} opacity={s.opacity} strokeLinecap="round">
      {BONES.map(({ a, b, side }) => {
        const pa = P(frame.kp[a]!);
        const pb = P(frame.kp[b]!);
        return (
          <line
            key={`${a}-${b}`}
            x1={pa.x}
            y1={pa.y}
            x2={pb.x}
            y2={pb.y}
            stroke={s.color}
            strokeOpacity={side === "far" ? 0.45 : 1}
            strokeWidth={(side === "far" ? sw * 0.8 : sw) * (variant === "ghost" ? 0.75 : 1)}
          />
        );
      })}
      <circle cx={head.x} cy={head.y} r={r} fill="none" stroke={s.color} strokeWidth={sw * 0.8} />
      {joints &&
        variant !== "ghost" &&
        frame.kp.slice(5).map((p, i) => {
          const q = P(p);
          return <circle key={i} cx={q.x} cy={q.y} r={sw * 0.42} fill="#07090D" stroke={s.color} strokeWidth={sw * 0.28} opacity={p.c < 0.6 ? 0.4 : 1} />;
        })}
    </g>
  );
}

/** 関節の角度を円弧とラベルで示す */
export function AngleArc({ frame, a, b, c, cam: camProp, label, color = "#FF7A1A", offset = { x: 0, y: 0 } }: { frame: PoseFrame; a: KeypointName; b: KeypointName; c: KeypointName; cam?: Camera; label?: string; color?: string; offset?: Vec2 }) {
  const cam = useCamera(camProp);
  const P = (p: Vec2) => project(cam, { x: p.x + offset.x, y: p.y + offset.y });
  const A = P(kp(frame, a));
  const B = P(kp(frame, b));
  const C = P(kp(frame, c));
  const deg = jointAngle(kp(frame, a), kp(frame, b), kp(frame, c));
  const a1 = Math.atan2(A.y - B.y, A.x - B.x);
  const a2 = Math.atan2(C.y - B.y, C.x - B.x);
  const r = scale(cam, 0.13);
  let d = a2 - a1;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const sweep = d > 0 ? 1 : 0;
  const p1 = { x: B.x + r * Math.cos(a1), y: B.y + r * Math.sin(a1) };
  const p2 = { x: B.x + r * Math.cos(a2), y: B.y + r * Math.sin(a2) };
  const mid = a1 + d / 2;
  const lx = B.x + (r + 46) * Math.cos(mid);
  const ly = B.y + (r + 46) * Math.sin(mid);
  return (
    <g>
      <path d={`M${B.x} ${B.y} L${p1.x} ${p1.y} A${r} ${r} 0 0 ${sweep} ${p2.x} ${p2.y} Z`} fill={color} fillOpacity={0.14} stroke={color} strokeWidth={3} />
      <g transform={`translate(${lx} ${ly})`}>
        <rect x={-62} y={-24} width={124} height={44} rx={10} fill="#07090D" fillOpacity={0.85} stroke={color} strokeOpacity={0.6} />
        <text textAnchor="middle" y={8} fill={color} fontSize={26} fontFamily="var(--font-mono)" fontWeight={600}>
          {label ? `${label} ` : ""}
          {Math.round(deg)}°
        </text>
      </g>
    </g>
  );
}

/** 関節の軌跡（新しい点ほど濃い） */
export function Trail({ frames, joint, from, to, cam: camProp, color = "#FF7A1A", offset = { x: 0, y: 0 } }: { frames: PoseFrame[]; joint: KeypointName; from: number; to: number; cam?: Camera; color?: string; offset?: Vec2 }) {
  const cam = useCamera(camProp);
  const pts = frames.slice(Math.max(0, from), Math.max(0, to) + 1).map((f) => project(cam, { x: kp(f, joint).x + offset.x, y: kp(f, joint).y + offset.y }));
  if (pts.length < 2) return null;
  return (
    <g>
      {pts.slice(1).map((p, i) => {
        const q = pts[i]!;
        return <line key={i} x1={q.x} y1={q.y} x2={p.x} y2={p.y} stroke={color} strokeWidth={4} strokeLinecap="round" strokeOpacity={0.15 + 0.85 * ((i + 1) / pts.length)} />;
      })}
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3.5} fill={color} opacity={0.2 + 0.6 * (i / pts.length)} />
      ))}
    </g>
  );
}

export function Hud({ tl, tr, bl, br }: { tl?: string[]; tr?: string[]; bl?: string[]; br?: string[] }) {
  const t = (lines: string[] | undefined, x: number, y: number, anchor: "start" | "end", up = false) =>
    lines?.map((s, i) => (
      <text key={i} x={x} y={up ? y - (lines.length - 1 - i) * 34 : y + i * 34} textAnchor={anchor} fill="#e8edf2" fillOpacity={i === 0 ? 0.9 : 0.55} fontSize={i === 0 ? 26 : 22} fontFamily="var(--font-mono)" letterSpacing={2}>
        {s}
      </text>
    ));
  return (
    <g pointerEvents="none">
      {t(tl, 40, 56, "start")}
      {t(tr, W - 40, 56, "end")}
      {t(bl, 40, H - 40, "start", true)}
      {t(br, W - 40, H - 40, "end", true)}
    </g>
  );
}

/** 小さなサムネイル用：指定フレームの骨格だけを描く */
export function PoseThumb({ frame, className, variant = "self", cam: camProp }: { frame: PoseFrame; className?: string; variant?: Variant; cam?: Camera }) {
  // データによって座標の原点が違うので、骨格に合わせて範囲を決める
  const cam = camProp ?? fitCamera([frame]);
  return (
    <FieldScene cam={cam} className={className}>
      <Skeleton frame={frame} cam={cam} variant={variant} joints={false} width={1.3} />
    </FieldScene>
  );
}
