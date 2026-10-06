import { IconBrandGithub, IconBrandYoutube, IconHome, IconMovie, IconRoute, IconTarget } from "@tabler/icons-react";
import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import { NavLink, Outlet, ScrollRestoration, useLocation } from "react-router";
import { STEPS, type StepKey } from "../guide/content";
import { TourProvider, useTour } from "../guide/Tour";
import { useAnalyzer } from "../state/analyzer";
import { useCoach } from "../state/benchmarks";
import { useDataSource, useLocalData } from "../state/local";
import { Segmented, cx } from "./ui";

/** パスから、使う流れのどの段階にいるかを決める */
function stepOf(path: string): StepKey | undefined {
  if (path === "/sessions/new" || /\/reps$/.test(path) || path === "/footage" || /^\/footage\/[^/]+\/pick$/.test(path)) return "import";
  if (/^\/footage\/[^/]+$/.test(path)) return "watch";
  if (/\/(studio|compare)$/.test(path)) return "watch";
  if (/\/report$/.test(path)) return "fix";
  if (path === "/progress") return "keep";
  return undefined;
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#0E131A" stroke="rgba(255,255,255,0.1)" />
        <g stroke="#2EE59D" strokeWidth="2.4" strokeLinecap="round" fill="none" className="glow-turf">
          <circle cx="16" cy="8" r="3" />
          <path d="M16 11v9M16 14l-6-3M16 14l6-5M16 20l-5 7M16 20l5 7" />
        </g>
        <circle cx="24" cy="7" r="2" fill="#FF7A1A" />
      </svg>
      <div className="leading-none">
        <div className="font-display text-[19px] tracking-wider">FILM COACH</div>
        <div className="mt-0.5 text-[10px] tracking-wide text-muted">AI フィルムルーム</div>
      </div>
    </div>
  );
}

function SideLink({ to, end, children, active }: { to: string; end?: boolean; children: React.ReactNode; active?: boolean }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => cx("relative flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors", isActive || active ? "text-text" : "text-muted hover:bg-white/[0.04] hover:text-text")}>
      {({ isActive }) => (
        <>
          {(isActive || active) && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg border border-line bg-white/[0.06]" transition={{ type: "spring", duration: 0.4, bounce: 0.15 }} />}
          {children}
        </>
      )}
    </NavLink>
  );
}

/** 表示するデータ（手元の練習かデモ）。手元に練習がなければ「デモデータ（架空）」とだけ出す */
function DataSourceSwitch() {
  const ds = useDataSource();
  if (!ds.available) return <span>デモデータ（架空）</span>;
  return (
    <Segmented
      label="表示するデータ"
      size="sm"
      value={ds.source}
      onChange={ds.setSource}
      options={[
        { value: "local", label: "手元の練習" },
        { value: "demo", label: "デモ" },
      ]}
    />
  );
}

function Shell() {
  const location = useLocation();
  const { coach, source } = useCoach();
  const { available } = useDataSource();
  const { reload } = useLocalData();
  const tour = useTour();
  const analyzer = useAnalyzer();
  const player = coach.player();
  const sid = coach.focus().session.id;
  const current = stepOf(location.pathname);
  // 手元のデータでは、取り込みは「自分の映像」から（新規セッションの画面はデモのシミュレーション）
  const to: Record<StepKey, string> = { import: source === "local" ? "/footage" : "/sessions/new", watch: `/sessions/${sid}/studio`, fix: `/sessions/${sid}/report`, keep: "/progress" };

  // ほかの画面で解析・登録した結果を映すため、画面を移ったら手元のデータを読み直す（最初は LocalDataProvider が読む）
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void reload();
  }, [location.pathname, reload]);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="no-print sticky top-0 z-20 border-b border-line bg-ink/90 backdrop-blur lg:h-screen lg:border-r lg:border-b-0">
        <div className="px-5 py-4 lg:py-6">
          <Logo />
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:block lg:overflow-visible lg:pb-0" aria-label="メイン">
          <SideLink to="/" end>
            <IconHome size={17} stroke={1.75} className="relative" aria-hidden />
            <span className="relative whitespace-nowrap">ホーム</span>
          </SideLink>
          <SideLink to="/footage">
            <IconMovie size={17} stroke={1.75} className="relative" aria-hidden />
            <span className="relative whitespace-nowrap">自分の映像</span>
            {analyzer.status !== "none" && (
              <span
                className={cx("relative ml-auto h-2 w-2 rounded-full", analyzer.status === "online" ? "bg-turf" : analyzer.status === "checking" ? "bg-caution" : "bg-flag")}
                title={analyzer.status === "online" ? "解析サービスにつながっています" : "解析サービスにつながっていません"}
                aria-label={analyzer.status === "online" ? "解析サービスにつながっています" : "解析サービスにつながっていません"}
              />
            )}
          </SideLink>

          {/* 使う流れ（4 段階） */}
          <div className="flex gap-1 lg:mt-5 lg:block" data-tour="nav-steps">
            <div className="hidden px-3 pb-2 text-[11px] text-faint lg:block">使う流れ</div>
            <ol className="flex gap-1 lg:relative lg:block lg:space-y-0.5">
              <span className="absolute top-5 bottom-5 left-[25px] hidden w-px bg-line lg:block" aria-hidden />
              {STEPS.map((s) => {
                const on = current === s.key;
                // 「自分の映像」の画面では、そのリンクだけを選んだ状態にする（段階は番号の色で示す）
                const highlight = on && !location.pathname.startsWith("/footage");
                return (
                  <li key={s.key}>
                    <SideLink to={to[s.key]} active={highlight}>
                      <span className={cx("relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px]", on ? "border-turf bg-turf text-ink" : "border-line-strong bg-ink text-muted")}>{s.no}</span>
                      <span className="relative min-w-0">
                        <span className="block whitespace-nowrap">{s.title}</span>
                        <span className="hidden truncate text-[11px] text-faint lg:block">{s.desc}</span>
                      </span>
                    </SideLink>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="flex gap-1 lg:mt-5 lg:block">
            <div className="hidden px-3 pb-2 text-[11px] text-faint lg:block">判定の基準</div>
            <SideLink to="/references">
              <IconBrandYoutube size={17} stroke={1.75} className="relative" aria-hidden />
              <span className="relative whitespace-nowrap">お手本ライブラリ</span>
            </SideLink>
          </div>

          <div className="flex gap-1 lg:mt-5 lg:block">
            <div className="hidden px-3 pb-2 text-[11px] text-faint lg:block">解析の確かさ</div>
            <SideLink to="/evaluation">
              <IconTarget size={17} stroke={1.75} className="relative" aria-hidden />
              <span className="relative whitespace-nowrap">精度の評価</span>
            </SideLink>
          </div>
          {/* 狭い画面ではサイドバーの下部が出ないので、ここに表示するデータとツアーを置く */}
          {available && (
            <div className="flex shrink-0 items-center lg:hidden">
              <DataSourceSwitch />
            </div>
          )}
          <button type="button" onClick={tour.start} className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-turf lg:hidden">
            <IconRoute size={16} aria-hidden />
            ツアー
          </button>
        </nav>

        <div className="absolute inset-x-0 bottom-0 hidden space-y-3 border-t border-line p-4 lg:block">
          <button type="button" onClick={tour.start} className="flex w-full items-center gap-2 rounded-lg border border-turf/30 bg-turf/[0.06] px-3 py-2 text-sm text-turf hover:bg-turf/10">
            <IconRoute size={16} aria-hidden />
            使い方ツアー
          </button>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-turf/30 bg-turf/10 font-display text-turf">{player.number !== undefined ? `#${player.number}` : player.position}</div>
            <div className="min-w-0 text-xs">
              <div className="truncate text-sm text-text">{player.name ?? "あなた"}</div>
              <div className="text-muted">
                {player.position} · {player.throws}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 text-[11px] text-faint">
            <DataSourceSwitch />
            <a href="https://github.com/motoharuinoue/film-coach" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-text" aria-label="GitHub リポジトリ">
              <IconBrandGithub size={14} aria-hidden />
              GitHub
            </a>
          </div>
        </div>
      </aside>
      <main className="bg-grid min-w-0">
        <motion.div key={location.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }} className="mx-auto max-w-[1280px] px-5 py-8 lg:px-10">
          <Outlet />
        </motion.div>
      </main>
    </div>
  );
}

export function AppShell() {
  return (
    <TourProvider>
      <Shell />
      {/* 画面を移ったら上から表示する（戻ったときは元の位置） */}
      <ScrollRestoration />
    </TourProvider>
  );
}
