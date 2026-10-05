import { IconBrandYoutube, IconCalendarEvent, IconCheck, IconDeviceMobile, IconLayersSubtract, IconPlus, IconX } from "@tabler/icons-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { Footage } from "../../../domain/footage";
import { PRACTICE_KIND_LABEL, PRACTICE_LIMITS, type Practice } from "../../../domain/practice";
import { Badge, Button, Card, PageHeader, SectionTitle, cx } from "../../components/ui";
import { PageGuide } from "../../guide/PageGuide";
import { useAnalyzer } from "../../state/analyzer";
import { AnalyzerGate } from "./AnalyzerGate";

const STATUS = {
  none: { tone: "caution", text: "本人を選ぶ前", action: "本人を選ぶ" },
  running: { tone: "caution", text: "追跡中", action: "進み具合を見る" },
  done: { tone: "turf", text: "追跡済み", action: "見る" },
  failed: { tone: "flag", text: "追跡に失敗", action: "選び直す" },
} as const;

export function thumbnail(lib: ReturnType<typeof useAnalyzer>["lib"], f: Footage) {
  if (f.youtube) return `https://i.ytimg.com/vi/${f.youtube.videoId}/hqdefault.jpg`;
  return lib?.frameUrl(f, f.info.duration * 0.3) ?? undefined;
}

const today = () => new Date().toLocaleDateString("sv-SE");

function Practices({ items }: { items: Practice[] }) {
  if (!items.length) return null;
  return (
    <section className="space-y-3">
      <SectionTitle>練習</SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((p) => (
          <Link key={p.id} to={`/footage/practices/${p.id}`} className="card group flex items-center gap-3 px-4 py-3 transition-colors hover:border-turf/40">
            <IconLayersSubtract size={20} className="shrink-0 text-turf" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm group-hover:text-turf">{p.name}</div>
              <div className="text-[11px] text-muted">
                {p.date} · {PRACTICE_KIND_LABEL[p.kind]} · 映像 {p.videoIds.length} 本
              </div>
            </div>
            <span className="text-[11px] text-muted group-hover:text-turf">比べる →</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** 選んだ映像を練習にまとめる。名前と日付だけ聞く（種別はドリル、角度は横から） */
function GroupBar({ count, onCancel, onCreate, busy, error }: { count: number; onCancel: () => void; onCreate: (name: string, date: string) => void; busy: boolean; error?: string }) {
  const [name, setName] = useState("");
  const [date, setDate] = useState(today());
  const ok = count > 0 && name.trim().length > 0 && name.length <= PRACTICE_LIMITS.name && /^\d{4}-\d{2}-\d{2}$/.test(date);
  return (
    <motion.form
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="card sticky bottom-4 z-20 flex flex-wrap items-end gap-3 border-turf/30 p-4 shadow-2xl"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok && !busy) onCreate(name.trim(), date);
      }}
    >
      <div className="text-sm">
        <span className="font-display text-xl text-turf">{count}</span> 本を選んでいます
      </div>
      <div>
        <label htmlFor="practice-name" className="mb-1 block text-xs text-muted">
          練習の名前
        </label>
        <input id="practice-name" value={name} onChange={(e) => setName(e.target.value.slice(0, PRACTICE_LIMITS.name))} placeholder="投球ドリル" className="w-48 rounded-lg border border-line bg-ink px-3 py-2 text-sm focus:border-ice/50 focus:outline-none" />
      </div>
      <div>
        <label htmlFor="practice-date" className="mb-1 block text-xs text-muted">
          <IconCalendarEvent size={12} className="mr-0.5 inline" aria-hidden />
          日付
        </label>
        <input id="practice-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-line bg-ink px-3 py-2 font-mono text-sm focus:border-ice/50 focus:outline-none" />
      </div>
      <Button type="submit" variant="primary" disabled={!ok || busy}>
        <IconCheck size={16} aria-hidden /> まとめる
      </Button>
      <Button onClick={onCancel}>
        <IconX size={15} aria-hidden /> やめる
      </Button>
      {error && <p className="w-full text-xs text-flag">{error}</p>}
    </motion.form>
  );
}

function List() {
  const { lib } = useAnalyzer();
  const navigate = useNavigate();
  const [items, setItems] = useState<Footage[]>();
  const [practices, setPractices] = useState<Practice[]>([]);
  const [error, setError] = useState<string>();
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string>();
  useEffect(() => {
    lib
      ?.list()
      .then(setItems)
      .catch((e: Error) => setError(e.message));
    lib
      ?.practices()
      .then(setPractices)
      .catch(() => setPractices([]));
  }, [lib]);

  const toggle = (id: string) => setPicked((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id].slice(0, PRACTICE_LIMITS.videos)));
  const create = async (name: string, date: string) => {
    if (!lib) return;
    setBusy(true);
    setCreateError(undefined);
    try {
      const p = await lib.createPractice({ name, date, kind: "drill", camera: "side", memo: "", videoIds: picked });
      navigate(`/footage/practices/${p.id}`);
    } catch (e) {
      setCreateError((e as Error).message);
      setBusy(false);
    }
  };

  if (error) return <p className="text-sm text-flag">{error}</p>;
  if (!items) return <p className="text-sm text-muted">読み込んでいます…</p>;
  if (items.length === 0) {
    return (
      <Card className="p-8 text-center">
        <h2 className="text-lg font-semibold">最初の映像を取り込みましょう</h2>
        <p className="mt-2 text-sm text-muted">スマホで撮った動画か、YouTube の区間を取り込むと、本人を選んで追跡できます。</p>
        <Link to="/sessions/new" className="mt-5 inline-block">
          <Button variant="primary">
            <IconPlus size={16} aria-hidden /> 映像を取り込む
          </Button>
        </Link>
      </Card>
    );
  }
  return (
    <div className="space-y-6">
      <Practices items={practices} />
      <section className="space-y-3">
        <SectionTitle
          right={
            !selecting && (
              <Button onClick={() => setSelecting(true)}>
                <IconLayersSubtract size={15} aria-hidden /> 練習にまとめる
              </Button>
            )
          }
        >
          映像
        </SectionTitle>
        {selecting && <p className="text-xs text-muted">練習にまとめる映像を選んでください（選んだ順に並べます）。投球を比べるには、本人の追跡が済んでいる映像を選びます。</p>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((f, i) => {
            const st = STATUS[f.trackStatus];
            const to = f.trackStatus === "done" ? `/footage/${f.id}` : `/footage/${f.id}/pick`;
            const thumb = thumbnail(lib, f);
            const order = picked.indexOf(f.id);
            return (
              <motion.div key={f.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="relative">
                {selecting && (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={order >= 0}
                    aria-label={`${f.name} を選ぶ`}
                    onClick={() => toggle(f.id)}
                    className={cx("absolute inset-0 z-10 rounded-[inherit] border-2 transition-colors", order >= 0 ? "border-turf bg-turf/10" : "border-transparent hover:border-white/30")}
                  >
                    <span className={cx("absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full font-display text-sm", order >= 0 ? "bg-turf text-ink" : "bg-black/60 text-muted ring-1 ring-white/30")}>{order >= 0 ? order + 1 : ""}</span>
                  </button>
                )}
                <Link to={to} tabIndex={selecting ? -1 : undefined} className="card group block overflow-hidden transition-colors hover:border-turf/40">
                  <div className="relative aspect-video bg-black">
                    {thumb && <img src={thumb} alt="" className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100" loading="lazy" />}
                    <div className="absolute top-2 left-2 flex gap-1">
                      <Badge tone={f.source === "youtube" ? "flag" : "neutral"}>
                        {f.source === "youtube" ? <IconBrandYoutube size={12} aria-hidden /> : <IconDeviceMobile size={12} aria-hidden />}
                        {f.source === "youtube" ? "YouTube" : "ファイル"}
                      </Badge>
                      {f.label && <Badge tone="pylon">{f.label}</Badge>}
                    </div>
                    <span className="absolute right-2 bottom-2 rounded bg-black/70 px-1.5 font-mono text-[11px]">{f.info.duration.toFixed(1)}s</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm group-hover:text-turf">{f.name}</div>
                      <div className="text-[11px] text-muted">
                        {f.info.width}×{f.info.height} · {f.info.fps.toFixed(0)} fps · {new Date(f.createdAt).toLocaleDateString("ja-JP")}
                      </div>
                    </div>
                    <Badge tone={st.tone} className="shrink-0">
                      {st.text}
                    </Badge>
                  </div>
                  <div className="border-t border-line px-4 py-2 text-[11px] text-muted group-hover:text-turf">{st.action} →</div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </section>
      {selecting && (
        <GroupBar
          count={picked.length}
          busy={busy}
          error={createError}
          onCreate={create}
          onCancel={() => {
            setSelecting(false);
            setPicked([]);
          }}
        />
      )}
    </div>
  );
}

export function FootageList() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="自分の映像"
        sub="手元の解析サービスに取り込んだ映像。本人を選んで追跡し、骨格を重ねて見られます"
        right={
          <Link to="/sessions/new">
            <Button variant="primary">
              <IconPlus size={16} aria-hidden /> 取り込む
            </Button>
          </Link>
        }
      />
      <PageGuide id="footage" />
      <AnalyzerGate>
        <List />
      </AnalyzerGate>
    </div>
  );
}
