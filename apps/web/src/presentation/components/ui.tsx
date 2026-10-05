import { IconAlertCircle, IconAlertTriangle, IconCircleCheck, IconCircleDashed } from "@tabler/icons-react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, type ReactNode } from "react";
import { STATUS_LABEL, type Status } from "../../domain/judgement";

export function cx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("card", className)} {...rest}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cx("mb-3 flex items-center justify-between gap-3", className)}>
      <h2 className="text-[13px] font-medium tracking-wide text-muted">{children}</h2>
      {right}
    </div>
  );
}

export function PageHeader({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

const STATUS_STYLE: Record<Status, { cls: string; Icon: typeof IconCircleCheck }> = {
  good: { cls: "text-turf bg-turf/10 border-turf/25", Icon: IconCircleCheck },
  caution: { cls: "text-caution bg-caution/10 border-caution/25", Icon: IconAlertCircle },
  flag: { cls: "text-flag bg-flag/10 border-flag/25", Icon: IconAlertTriangle },
  na: { cls: "text-muted bg-white/5 border-line", Icon: IconCircleDashed },
};

export const STATUS_TEXT: Record<Status, string> = {
  good: "text-turf",
  caution: "text-caution",
  flag: "text-flag",
  na: "text-muted",
};

export function StatusPill({ status, className }: { status: Status; className?: string }) {
  const { cls, Icon } = STATUS_STYLE[status];
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", cls, className)}>
      <Icon size={12} stroke={2} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function StatusIcon({ status, size = 14 }: { status: Status; size?: number }) {
  const { Icon } = STATUS_STYLE[status];
  return <Icon size={size} stroke={2} className={STATUS_TEXT[status]} aria-label={STATUS_LABEL[status]} />;
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "turf" | "ice" | "pylon" | "caution" | "flag"; className?: string }) {
  const tones = {
    neutral: "bg-white/5 text-muted border-line",
    turf: "bg-turf/10 text-turf border-turf/25",
    ice: "bg-ice/10 text-ice border-ice/25",
    pylon: "bg-pylon/10 text-pylon border-pylon/25",
    caution: "bg-caution/10 text-caution border-caution/25",
    flag: "bg-flag/10 text-flag border-flag/25",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium", tones[tone], className)}>{children}</span>;
}

export function Button({
  children,
  variant = "secondary",
  className,
  ...rest
}: { children: ReactNode; variant?: "primary" | "secondary" | "ghost" } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const variants = {
    primary: "bg-turf text-ink hover:bg-turf/90 font-semibold",
    secondary: "bg-white/[0.06] text-text hover:bg-white/[0.1] border border-line",
    ghost: "text-muted hover:text-text hover:bg-white/5",
  };
  return (
    <button
      type="button"
      className={cx("inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors disabled:opacity-40", variants[variant], className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  size?: "sm" | "md";
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-white/[0.03] p-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cx(
              "relative rounded-md transition-colors disabled:opacity-35",
              size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm",
              on ? "text-text" : "text-muted hover:text-text",
            )}
          >
            {on && <motion.span layoutId={`seg-${label}`} className="absolute inset-0 rounded-md bg-white/10" transition={{ type: "spring", duration: 0.35, bounce: 0.15 }} />}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ on, onChange, children, tone = "turf" }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode; tone?: "turf" | "ice" | "pylon" }) {
  const onCls = { turf: "border-turf/40 bg-turf/10 text-turf", ice: "border-ice/40 bg-ice/10 text-ice", pylon: "border-pylon/40 bg-pylon/10 text-pylon" }[tone];
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={cx("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors", on ? onCls : "border-line text-muted hover:text-text")}
    >
      {children}
    </button>
  );
}

/** 数値のカウントアップ */
export function CountUp({ value, digits = 0, className }: { value: number; digits?: number; className?: string }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(reduce ? value : 0);
  const text = useTransform(mv, (v) => v.toFixed(digits));
  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const c = animate(mv, value, { duration: 1.1, ease: [0.16, 1, 0.3, 1] });
    return () => c.stop();
  }, [mv, value, reduce]);
  return <motion.span className={className}>{text}</motion.span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-white/5 px-1 font-mono text-[10px] text-muted">{children}</kbd>;
}

export function DemoNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-ice/20 bg-ice/[0.06] px-3 py-2 text-xs leading-relaxed text-ice/90">
      <IconCircleDashed size={14} className="mt-0.5 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}
