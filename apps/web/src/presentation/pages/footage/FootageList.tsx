import { IconBrandYoutube, IconDeviceMobile, IconPlus } from "@tabler/icons-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { Footage } from "../../../domain/footage";
import { Badge, Button, Card, PageHeader } from "../../components/ui";
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

function List() {
  const { lib } = useAnalyzer();
  const [items, setItems] = useState<Footage[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    lib
      ?.list()
      .then(setItems)
      .catch((e: Error) => setError(e.message));
  }, [lib]);

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
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((f, i) => {
        const st = STATUS[f.trackStatus];
        const to = f.trackStatus === "done" ? `/footage/${f.id}` : `/footage/${f.id}/pick`;
        const thumb = thumbnail(lib, f);
        return (
          <motion.div key={f.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
            <Link to={to} className="card group block overflow-hidden transition-colors hover:border-turf/40">
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
