import {
  IconArrowsLeftRight,
  IconBrandGithub,
  IconBrandYoutube,
  IconChartLine,
  IconFileText,
  IconHome,
  IconLayoutGrid,
  IconMovie,
  IconUpload,
} from "@tabler/icons-react";
import { motion } from "motion/react";
import { NavLink, Outlet, useLocation } from "react-router";
import type { Session } from "../../domain/entities";
import { useServices } from "../services";
import { formatDate } from "../state/session";
import { cx } from "./ui";

type NavGroup = { group?: string; items: { to: string; label: string; Icon: typeof IconHome; end?: boolean }[] };

const nav = (current: Session): NavGroup[] => [
  {
    items: [
      { to: "/", label: "ホーム", Icon: IconHome, end: true },
      { to: "/sessions/new", label: "新規セッション", Icon: IconUpload },
    ],
  },
  {
    group: `セッション ${formatDate(current.date)}`,
    items: [
      { to: `/sessions/${current.id}/reps`, label: "レップ選択", Icon: IconLayoutGrid },
      { to: `/sessions/${current.id}/studio`, label: "分析スタジオ", Icon: IconMovie },
      { to: `/sessions/${current.id}/compare`, label: "比較", Icon: IconArrowsLeftRight },
      { to: `/sessions/${current.id}/report`, label: "レポート", Icon: IconFileText },
    ],
  },
  {
    group: "ライブラリ",
    items: [
      { to: "/references", label: "お手本ライブラリ", Icon: IconBrandYoutube },
      { to: "/progress", label: "推移", Icon: IconChartLine },
    ],
  },
];

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

export function AppShell() {
  const location = useLocation();
  const { coach } = useServices();
  const player = coach.player();
  const NAV = nav(coach.focus().session);
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="no-print sticky top-0 z-20 border-b border-line bg-ink/90 backdrop-blur lg:h-screen lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between px-5 py-4 lg:py-6">
          <Logo />
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:block lg:space-y-5 lg:overflow-visible lg:pb-0" aria-label="メイン">
          {NAV.map((g, gi) => (
            <div key={gi} className="flex gap-1 lg:block lg:space-y-0.5">
              {g.group && <div className="hidden px-3 pb-1.5 text-[11px] text-faint lg:block">{g.group}</div>}
              {g.items.map(({ to, label, Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    cx(
                      "relative flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                      isActive ? "text-text" : "text-muted hover:bg-white/[0.04] hover:text-text",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg border border-line bg-white/[0.06]" transition={{ type: "spring", duration: 0.4, bounce: 0.15 }} />}
                      <Icon size={17} stroke={1.75} className={cx("relative", isActive && "text-turf")} aria-hidden />
                      <span className="relative whitespace-nowrap">{label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="absolute inset-x-0 bottom-0 hidden border-t border-line p-4 lg:block">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-turf/30 bg-turf/10 font-display text-turf">#{player.number}</div>
            <div className="min-w-0 text-xs">
              <div className="truncate text-sm text-text">{player.name}</div>
              <div className="text-muted">
                {player.position} · {player.throws}
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-faint">
            <span>デモデータ（架空）</span>
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
