import { IconLock, IconPointer } from "@tabler/icons-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { CAMERA_LABEL } from "../../domain/camera";
import { METRIC_BY_KEY } from "../../domain/metrics";
import { PoseThumb } from "../components/scene";
import { Badge, Card, DemoNote, PageHeader, SectionTitle, StatusPill, cx } from "../components/ui";
import { PageGuide } from "../guide/PageGuide";
import { useCoach } from "../state/benchmarks";
import { formatDate, repLabel, useSessionRep } from "../state/session";

export function Reps() {
  const { session } = useSessionRep();
  const { coach, bench, source } = useCoach();
  const sessions = coach.sessions();
  const focus = coach.focus().rep;
  const scores = session.reps.map((r) => coach.repScore(r, bench));
  const best = Math.max(...scores);

  return (
    <div className="space-y-6">
      <PageHeader
        title="① 取り込む：レップを選ぶ"
        sub={`${formatDate(session.date)} ${session.title} · ${CAMERA_LABEL[session.camera]} · ${session.reps.length} レップを自動で切り出しました`}
        right={
          <div className="flex gap-2">
            {sessions.map((s) => (
              <Link key={s.id} to={`/sessions/${s.id}/reps`} className={cx("rounded-md border px-2 py-1 text-xs", s.id === session.id ? "border-turf/40 bg-turf/10 text-turf" : "border-line text-muted hover:text-text")}>
                {formatDate(s.date)}
              </Link>
            ))}
          </div>
        }
      />

      <PageGuide id="reps" sessionId={session.id} />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {session.reps.map((r, i) => {
          const f = coach.findings(r, session.camera, bench)[0];
          const isFocus = r.id === focus.id;
          return (
            <motion.div key={r.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
              <Link to={`/sessions/${session.id}/studio?rep=${i + 1}`} className={cx("card group block overflow-hidden transition-colors hover:border-turf/40", isFocus && "border-pylon/50")}>
                <div className="relative">
                  <PoseThumb frame={r.seq.frames[r.events.release]!} className="block aspect-video w-full" />
                  <div className="absolute top-2 left-2 flex gap-1">
                    <Badge>{repLabel(i)}</Badge>
                    {scores[i] === best && <Badge tone="turf">ベスト</Badge>}
                    {isFocus && <Badge tone="pylon">注目</Badge>}
                  </div>
                  <div className="absolute right-2 bottom-1 font-display text-3xl text-text/90">{scores[i]}</div>
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2.5">
                  <span className="truncate text-xs text-muted">{f ? METRIC_BY_KEY[f.key].short : "大きな崩れなし"}</span>
                  {f ? <StatusPill status={f.severity} /> : <StatusPill status="good" />}
                </div>
              </Link>
            </motion.div>
          );
        })}
      </div>

      {/* 試合映像での対象選手のロックは M4。手元のデータでは、本人は「自分の映像」で選んで追跡している */}
      {source === "demo" ? (
        <TargetLock />
      ) : (
        <DemoNote>
          この練習の投球は、「自分の映像」で本人を選んで追跡した骨格から切り出しています。試合映像で対象選手を 1 回押してロックする機能（SAM 2）は M4 で追加します。
          <Link to={`/footage/practices/${session.id}`} className="ml-1 text-ice underline">
            練習の画面で見る
          </Link>
        </DemoNote>
      )}
    </div>
  );
}

// ---- 試合映像での対象選手のロック（M4 で SAM 2 に置き換える） ----

type Player = { id: number; team: "off" | "def"; num: number; x: number; y: number };

function formation(): Player[] {
  const off: [number, number, number][] = [
    [7, 800, 470], // QB
    [72, 690, 395], [66, 745, 392], [55, 800, 390], [64, 855, 392], [77, 910, 395],
    [88, 970, 400], [21, 800, 530], [11, 360, 400], [84, 1260, 405], [15, 1130, 410],
  ];
  const def: [number, number, number][] = [
    [93, 720, 345], [97, 775, 342], [91, 830, 342], [99, 885, 345],
    [52, 700, 285], [54, 800, 275], [50, 900, 285],
    [24, 380, 330], [31, 1250, 330], [27, 690, 190], [33, 960, 195],
  ];
  return [
    ...off.map(([num, x, y], i) => ({ id: i, team: "off" as const, num, x, y })),
    ...def.map(([num, x, y], i) => ({ id: 100 + i, team: "def" as const, num, x, y })),
  ];
}

function TargetLock() {
  const players = useMemo(formation, []);
  const [locked, setLocked] = useState<number | undefined>();
  const target = players.find((p) => p.id === locked);
  const { coach } = useCoach();
  const game = coach.sessions().find((s) => s.kind === "game");
  // 選んだ選手の移動（ドロップバック → ポケット内の移動）を仮に描く
  const track = target ? [0, 1, 2, 3, 4, 5, 6].map((k) => ({ x: target.x + Math.sin(k * 0.9) * 14 * (target.team === "off" ? 1 : -1), y: target.y + k * (target.team === "off" ? 18 : -14) })) : [];

  return (
    <Card className="grid gap-0 overflow-hidden lg:grid-cols-[1.6fr_1fr]">
      <div className="relative bg-[#0a1a12]">
        <svg viewBox="0 0 1600 720" className="block w-full" role="img" aria-label="試合映像のフレーム。選手を押すと対象としてロックする">
          <defs>
            <linearGradient id="tl-turf" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#0b2016" />
              <stop offset="1" stopColor="#0f2c1e" />
            </linearGradient>
          </defs>
          <rect width="1600" height="720" fill="url(#tl-turf)" />
          {/* エンドゾーン側から見たヤードライン（遠近感あり） */}
          {Array.from({ length: 9 }, (_, i) => {
            const y = 120 + i * i * 9 + i * 20;
            return <line key={i} x1={0} x2={1600} y1={y} y2={y} stroke="#fff" strokeOpacity={i % 5 === 0 ? 0.22 : 0.09} strokeWidth={i % 5 === 0 ? 4 : 2} />;
          })}
          <line x1={640} y1={100} x2={560} y2={720} stroke="#fff" strokeOpacity={0.07} strokeWidth={3} strokeDasharray="10 22" />
          <line x1={960} y1={100} x2={1040} y2={720} stroke="#fff" strokeOpacity={0.07} strokeWidth={3} strokeDasharray="10 22" />
          {track.length > 0 && <polyline points={track.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#FF7A1A" strokeWidth={3} strokeDasharray="6 6" className="glow-pylon" />}
          {players.map((p) => {
            const on = p.id === locked;
            const s = 1 + (p.y - 200) / 700;
            return (
              <g key={p.id} transform={`translate(${p.x} ${p.y}) scale(${s})`} className="cursor-pointer" onClick={() => setLocked(p.id)} role="button" aria-label={`背番号 ${p.num} をロック`}>
                <ellipse cx={0} cy={22} rx={16} ry={5} fill="#000" opacity={0.35} />
                <rect x={-12} y={-26} width={24} height={46} rx={10} fill={p.team === "off" ? "#e8edf2" : "#2a3442"} stroke={on ? "#FF7A1A" : "transparent"} strokeWidth={4} />
                <circle cx={0} cy={-34} r={9} fill={p.team === "off" ? "#c9d1da" : "#1b232e"} />
                <text y={4} textAnchor="middle" fontSize={13} fontWeight={700} fill={p.team === "off" ? "#0b1017" : "#c9d1da"}>
                  {p.num}
                </text>
                {on && (
                  <motion.rect x={-22} y={-50} width={44} height={78} rx={14} fill="none" stroke="#FF7A1A" strokeWidth={2} initial={{ opacity: 0, scale: 1.4 }} animate={{ opacity: 1, scale: 1 }} className="glow-pylon" />
                )}
              </g>
            );
          })}
        </svg>
        {!target && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-ink/80 px-3 py-1.5 text-xs text-muted backdrop-blur">
              <IconPointer size={14} aria-hidden /> 追跡したい選手を押してください
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-col p-5">
        <SectionTitle right={<Badge tone="pylon">試合映像</Badge>}>対象選手のロック</SectionTitle>
        <p className="text-sm leading-relaxed text-muted">
          試合映像では 22 人が映ります。1 回押した選手を、SAM 2 のマスクでプレー中ずっと追い続けます。{game && `サンプル：${formatDate(game.date)} ${game.title}`}
        </p>
        <div className="mt-4 rounded-xl border border-line bg-white/[0.03] p-4">
          {target ? (
            <div className="flex items-center gap-3">
              <IconLock size={20} className="text-pylon" aria-hidden />
              <div>
                <div className="text-sm">
                  背番号 <span className="font-display text-xl">{target.num}</span> をロックしました
                </div>
                <div className="text-xs text-muted">{target.team === "off" ? (target.num === 7 ? "QB（本人）" : "オフェンス") : "ディフェンス"} · 推定の軌跡を表示しています</div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-faint">まだ選んでいません</div>
          )}
        </div>
        <div className="mt-auto pt-4">
          <DemoNote>M4 で SAM 2（Apache-2.0）の動画セグメンテーションと ByteTrack による追跡に置き換えます。背番号の自動認識は M5 の予定です。</DemoNote>
        </div>
      </div>
    </Card>
  );
}
