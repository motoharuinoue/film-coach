import { IconArrowRight, IconBulb, IconChevronUp, IconHelpCircle } from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";
import { Link } from "react-router";
import { cx } from "../components/ui";
import { usePersistentState } from "../hooks/usePersistentState";
import { useCoach } from "../state/benchmarks";
import { GUIDES, STEPS, type GuideId } from "./content";

/** 画面の上に出す「この画面でできること」。閉じると「使い方」ボタンだけになる */
export function PageGuide({ id, sessionId, className }: { id: GuideId; sessionId?: string; className?: string }) {
  const { coach } = useCoach();
  const [closed, setClosed] = usePersistentState(`film-coach:guide-closed:${id}`, false);
  const g = GUIDES[id];
  const step = STEPS.find((s) => s.key === g.step);
  const next = g.next && { ...g.next, to: g.next.to.replace(":sid", sessionId ?? coach.focus().session.id) };

  return (
    <div className={cx("no-print", className)} data-tour={`guide-${id}`}>
      <AnimatePresence initial={false} mode="wait">
        {closed ? (
          <motion.button
            key="closed"
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setClosed(false)}
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-muted hover:border-ice/40 hover:text-ice"
          >
            <IconHelpCircle size={14} aria-hidden />
            この画面の使い方
          </motion.button>
        ) : (
          <motion.section
            key="open"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden rounded-2xl border border-ice/20 bg-ice/[0.05]"
            aria-label="この画面でできること"
          >
            <div className="flex flex-wrap items-start gap-4 p-4">
              <IconBulb size={20} className="mt-0.5 shrink-0 text-ice" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {step && (
                    <span className="rounded-md bg-ice/15 px-1.5 py-0.5 font-mono text-[11px] text-ice">
                      STEP {step.no} · {step.title}
                    </span>
                  )}
                  <p className="text-sm text-text">{g.purpose}</p>
                </div>
                <ol className="mt-2 space-y-1">
                  {g.actions.map((a, i) => (
                    <li key={a} className="flex gap-2 text-xs leading-relaxed text-muted">
                      <span className="font-mono text-ice/80">{i + 1}.</span>
                      {a}
                    </li>
                  ))}
                </ol>
              </div>
              <div className="flex shrink-0 items-center gap-2 self-end">
                {next && (
                  <Link to={next.to} className="inline-flex items-center gap-1 rounded-lg border border-ice/30 px-2.5 py-1.5 text-xs text-ice hover:bg-ice/10">
                    {next.label} <IconArrowRight size={14} aria-hidden />
                  </Link>
                )}
                <button type="button" onClick={() => setClosed(true)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted hover:text-text" aria-label="使い方を閉じる">
                  <IconChevronUp size={14} aria-hidden />
                  閉じる
                </button>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
