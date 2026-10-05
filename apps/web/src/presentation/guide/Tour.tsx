// 初回のガイドツアー。主な画面を順に開き、見るべき場所を光らせて説明する。

import { IconArrowLeft, IconArrowRight, IconX } from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { Button, cx } from "../components/ui";
import { usePersistentState } from "../hooks/usePersistentState";
import { useServices } from "../services";

type TourStep = { route: string; target: string; title: string; body: string };

function steps(sid: string): TourStep[] {
  return [
    { route: "/", target: "nav-steps", title: "この順に使います", body: "① 取り込む → ② 見る → ③ 直す → ④ 続ける。サイドバーはこの流れで並んでいます。" },
    { route: "/", target: "home-score", title: "最新のスコア", body: "お手本ゾーン（YouTube のお手本を重み付けした分布）を満点とした点数です。前回比と、自己ベストとの差も出ます。" },
    { route: "/", target: "home-next", title: "次に直すこと", body: "いちばん外れている指標です。画像を押すと、分析スタジオでその根拠の場面が開きます。" },
    { route: `/sessions/${sid}/studio`, target: "studio-video", title: "② 骨格で見る", body: "投球に骨格・角度・手首の軌跡を重ねています。「ゴースト」で自己ベストかお手本の骨格も重ねられます。" },
    { route: `/sessions/${sid}/studio`, target: "studio-timeline", title: "フェーズとコマ送り", body: "帯を押すとそのフェーズへ移動します。Space で再生、← → で 1 コマずつ進みます。" },
    { route: `/sessions/${sid}/studio`, target: "studio-metrics", title: "指標カード", body: "自分の値・自己ベスト・お手本ゾーンを並べています。カードを押すと、その判定の根拠の場面へ移動します。" },
    { route: `/sessions/${sid}/report`, target: "report-findings", title: "③ 改善点を読む", body: "改善点トップ 3 に、目標の値と練習ドリルの動画が付きます。PDF にも出力できます。" },
    { route: "/references", target: "references-detail", title: "判定の基準を整える", body: "お手本ごとの重みの内訳です。除外やピン留めをすると、すべての画面の判定が変わります。" },
  ];
}

type Ctx = { start: () => void };
const TourContext = createContext<Ctx | null>(null);

export function useTour() {
  const c = useContext(TourContext);
  if (!c) throw new Error("TourProvider がありません");
  return c;
}

type Rect = { x: number; y: number; w: number; h: number };

export function TourProvider({ children }: { children: ReactNode }) {
  const { coach } = useServices();
  const navigate = useNavigate();
  const location = useLocation();
  const [seen, setSeen] = usePersistentState("film-coach:tour-seen", false);
  const [index, setIndex] = useState<number | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const list = useMemo(() => steps(coach.focus().session.id), [coach]);
  const step = index === null ? undefined : list[index];

  const start = useCallback(() => {
    setIndex(0);
    navigate("/");
  }, [navigate]);
  const close = useCallback(() => {
    setIndex(null);
    setSeen(true);
  }, [setSeen]);
  const go = useCallback((i: number) => (i < 0 ? undefined : i >= list.length ? close() : setIndex(i)), [list.length, close]);

  // 初めてホームを開いたら自動で始める
  useEffect(() => {
    if (!seen && index === null && location.pathname === "/") setIndex(0);
  }, [seen, index, location.pathname]);

  // ステップの画面を開く
  useEffect(() => {
    if (step && location.pathname !== step.route) navigate(step.route);
  }, [step, location.pathname, navigate]);

  // 光らせる要素を探して位置を測る（遅延読み込みの画面もあるので、見つかるまで待つ）
  useLayoutEffect(() => {
    if (!step) return;
    setRect(null);
    let raf = 0;
    let tries = 0;
    let el: Element | null = null;
    const measure = () => {
      if (!el) return;
      const b = el.getBoundingClientRect();
      setRect({ x: b.left, y: b.top, w: b.width, h: b.height });
    };
    const find = () => {
      el = document.querySelector(`[data-tour="${step.target}"]`);
      if (el) {
        // 画面より高い要素は上端を見せる
        const tall = el.getBoundingClientRect().height > window.innerHeight * 0.6;
        el.scrollIntoView({ block: tall ? "start" : "center", behavior: "smooth" });
        setTimeout(measure, 380);
      } else if (tries++ < 120) raf = requestAnimationFrame(find);
    };
    find();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step, location.pathname]);

  // ツアー中のキー操作（画面側のショートカットより先に受け取る）
  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, () => void> = { Escape: close, ArrowRight: () => go(index + 1), Enter: () => go(index + 1), ArrowLeft: () => go(index - 1) };
      const f = map[e.key];
      if (!f) return;
      e.preventDefault();
      e.stopPropagation();
      f();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [index, go, close]);

  return (
    <TourContext.Provider value={{ start }}>
      {children}
      <AnimatePresence>{step && index !== null && <TourOverlay key="tour" step={step} index={index} total={list.length} rect={rect} onNext={() => go(index + 1)} onPrev={() => go(index - 1)} onClose={close} />}</AnimatePresence>
    </TourContext.Provider>
  );
}

const PAD = 8;
const CARD_W = 340;
/** カードの高さの目安（配置の計算用） */
const CARD_H = 200;

function TourOverlay({ step, index, total, rect, onNext, onPrev, onClose }: { step: TourStep; index: number; total: number; rect: Rect | null; onNext: () => void; onPrev: () => void; onClose: () => void }) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(CARD_W, vw - 32);
  // カードは要素の 下 → 上 → 左 → 右 の順に、入る場所へ置く。どこにも入らなければ右下の隅
  const GAP = PAD + 12;
  const clampX = (x: number) => Math.max(16, Math.min(vw - w - 16, x));
  const clampY = (y: number) => Math.max(16, Math.min(vh - CARD_H - 16, y));
  let pos = { left: (vw - w) / 2, top: vh / 2 - CARD_H / 2 };
  if (rect) {
    if (rect.y + rect.h + GAP + CARD_H < vh) pos = { left: clampX(rect.x), top: rect.y + rect.h + GAP };
    else if (rect.y - GAP - CARD_H > 0) pos = { left: clampX(rect.x), top: rect.y - GAP - CARD_H };
    else if (rect.x - GAP - w > 16) pos = { left: rect.x - GAP - w, top: clampY(rect.y) };
    else if (rect.x + rect.w + GAP + w < vw - 16) pos = { left: rect.x + rect.w + GAP, top: clampY(rect.y) };
    else pos = { left: vw - w - 24, top: vh - CARD_H - 24 };
  }
  const last = index === total - 1;
  return (
    <motion.div className="no-print fixed inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true" aria-label="使い方ツアー">
      {/* 光らせる枠。外側を大きな影で暗くする。位置は style で直接決め、動きは CSS の transition に任せる */}
      <div
        className="pointer-events-none fixed rounded-2xl border-2 border-turf transition-all duration-300 ease-out motion-reduce:transition-none"
        style={{
          boxShadow: "0 0 0 9999px rgba(3,5,8,0.74), 0 0 24px rgba(46,229,157,0.45)",
          ...(rect ? { left: rect.x - PAD, top: rect.y - PAD, width: rect.w + PAD * 2, height: rect.h + PAD * 2, opacity: 1 } : { left: vw / 2, top: vh / 2, width: 0, height: 0, opacity: 0 }),
        }}
      />
      <div className="fixed rounded-2xl border border-line-strong bg-raised p-5 shadow-2xl transition-[left,top] duration-300 ease-out motion-reduce:transition-none" style={{ width: w, left: pos.left, top: pos.top }}>
        <div className="flex items-start justify-between gap-3">
          <div className="font-mono text-[11px] tracking-wider text-turf">
            {index + 1} / {total}
          </div>
          <button type="button" onClick={onClose} className="-m-1 rounded p-1 text-muted hover:text-text" aria-label="ツアーを終える">
            <IconX size={16} />
          </button>
        </div>
        <h2 className="mt-1 text-base font-semibold">{step.title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">{step.body}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="flex gap-1" aria-hidden>
            {Array.from({ length: total }, (_, i) => (
              <span key={i} className={cx("h-1.5 rounded-full transition-all", i === index ? "w-4 bg-turf" : "w-1.5 bg-white/20")} />
            ))}
          </div>
          <div className="flex gap-2">
            {index > 0 && (
              <Button variant="ghost" onClick={onPrev} aria-label="前へ">
                <IconArrowLeft size={15} />
              </Button>
            )}
            <Button variant="primary" onClick={onNext}>
              {last ? "はじめる" : "次へ"}
              {!last && <IconArrowRight size={15} aria-hidden />}
            </Button>
          </div>
        </div>
        {last && <p className="mt-3 text-[11px] text-faint">サイドバーの「使い方ツアー」から、いつでも見直せます。</p>}
      </div>
    </motion.div>
  );
}
