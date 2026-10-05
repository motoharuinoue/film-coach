// お手本を探す：YouTube Data API で候補を探し、人気度（P）と発信者（C）の見込みを添えて並べる。
// 気に入った候補は、埋め込みプレイヤーで確かめてから、区間だけを取り込む（ADR-0005）。
// 取り込んだ映像は、本人を選んで追跡し、投球を解析すると、お手本として登録できる（M2-2）。

import { IconBrandYoutube, IconClock, IconEye, IconKey, IconLoader2, IconSearch, IconThumbUp, IconUsers } from "@tabler/icons-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { creator, popularity } from "../../domain/weighting";
import { checkSegment, defaultSegment, formatTime, MAX_SEGMENT_SEC, SEARCH_COST, type QuotaStatus, type YouTubeCandidate, type YouTubeSearchResult } from "../../domain/youtube";
import { Badge, Button, Card, PageHeader, SectionTitle, Toggle, cx } from "../components/ui";
import { PageGuide } from "../guide/PageGuide";
import { useAnalyzer } from "../state/analyzer";
import { AnalyzerGate } from "./footage/AnalyzerGate";

const SUGGESTIONS = ["QB throwing mechanics", "quarterback footwork drill", "QB drop back drill", "quarterback release side view"];

const compact = (n: number | null) => (n === null ? "非公開" : new Intl.NumberFormat("ja-JP", { notation: "compact", maximumFractionDigits: 1 }).format(n));

function NoKey() {
  return (
    <Card className="max-w-2xl space-y-3 p-6">
      <div className="flex items-center gap-2">
        <IconKey size={20} className="text-caution" aria-hidden />
        <h2 className="font-semibold">YouTube Data API のキーがありません</h2>
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed text-muted">
        <li>Google Cloud のコンソールでプロジェクトを作り、「YouTube Data API v3」を有効にする</li>
        <li>「認証情報」で API キーを作り、「API の制限」を YouTube Data API v3 だけにする</li>
        <li>ターミナルで次を実行し、聞かれたらキーを貼り付ける（キーはこの Mac のキーチェーンにだけ置かれます）</li>
      </ol>
      <pre className="overflow-x-auto rounded-lg border border-line bg-ink p-3 font-mono text-xs text-text/90">security add-generic-password -a "$USER" -s film-coach-youtube -w</pre>
      <p className="text-[11px] text-faint">キーは画面にもログにも出しません。無料枠は 1 日 10,000 ユニット（検索 1 回で {SEARCH_COST} ユニット）です。</p>
    </Card>
  );
}

function QuotaMeter({ quota }: { quota: QuotaStatus }) {
  const ratio = quota.used / quota.limit;
  const resets = new Date(quota.resetsAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="min-w-56 space-y-1 text-[11px] text-muted">
      <div className="flex justify-between">
        <span>今日の無料枠</span>
        <span className="font-mono">
          {quota.used.toLocaleString()} / {quota.limit.toLocaleString()}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
        <div className={cx("h-full rounded-full", ratio > 0.8 ? "bg-flag" : ratio > 0.5 ? "bg-caution" : "bg-turf")} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
      <div className="text-faint">
        あと検索 {Math.floor(quota.remaining / SEARCH_COST)} 回 · {resets} に戻ります
      </div>
    </div>
  );
}

function Bar({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div title={hint}>
      <div className="flex justify-between text-[10px] text-muted">
        <span>{label}</span>
        <span className="font-mono">{value.toFixed(2)}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-white/5">
        <div className="h-full rounded-full bg-ice" style={{ width: `${value * 100}%` }} />
      </div>
    </div>
  );
}

function CandidateCard({ c, open, onOpen }: { c: YouTubeCandidate; open: boolean; onOpen: () => void }) {
  const { P, bayesRate } = popularity({ views: c.views, likes: c.likes ?? 0 });
  const C = creator({ subscribers: c.subscribers ?? 0, trustedChannel: false });
  return (
    <button type="button" onClick={onOpen} className={cx("card group block w-full overflow-hidden text-left transition-colors", open ? "border-turf/50" : "hover:border-white/20")}>
      <div className="relative aspect-video bg-black">
        {c.thumbnail && <img src={c.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover opacity-90 group-hover:opacity-100" />}
        <span className="absolute right-2 bottom-2 rounded bg-black/75 px-1.5 font-mono text-[11px]">{formatTime(c.durationSec)}</span>
        <div className="absolute top-2 left-2 flex gap-1">
          {c.license === "creativeCommon" && <Badge tone="turf">CC</Badge>}
          {c.definition === "hd" && <Badge>HD</Badge>}
        </div>
      </div>
      <div className="space-y-2 p-3">
        <div className="line-clamp-2 text-sm leading-snug group-hover:text-turf">{c.title}</div>
        <div className="truncate text-[11px] text-muted">
          {c.channel} · {c.publishedAt.slice(0, 10)}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1">
            <IconEye size={12} aria-hidden /> {compact(c.views)}
          </span>
          <span className="inline-flex items-center gap-1">
            <IconThumbUp size={12} aria-hidden /> {compact(c.likes)}
            {c.likes !== null && <span className="text-faint">（補正 {(bayesRate * 100).toFixed(1)}%）</span>}
          </span>
          <span className="inline-flex items-center gap-1">
            <IconUsers size={12} aria-hidden /> {compact(c.subscribers)}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 pt-1">
          <Bar label="P 人気度" value={P} hint="高評価率（件数の少ない動画で偏らないようベイズ平均で補正）と再生数" />
          <Bar label="C 発信者" value={C} hint="チャンネル登録者数（対数）" />
        </div>
      </div>
    </button>
  );
}

function ImportPanel({ c, onImported }: { c: YouTubeCandidate; onImported: (footageId: string) => void }) {
  const { lib } = useAnalyzer();
  const seg0 = defaultSegment(c.durationSec);
  const [start, setStart] = useState(formatTime(seg0.start));
  const [end, setEnd] = useState(formatTime(seg0.end));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const seg = checkSegment(start, end);
  const inside = seg.ok && (c.durationSec === 0 || seg.end <= c.durationSec);
  // 下の方の候補を開いても見えるよう、開いたら取り込みの欄まで動かす
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // 新しいブラウザでは Promise を返すので、片付けの関数と取り違えないよう何も返さない
    void panel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [c.videoId]);
  const run = async () => {
    if (!lib || !seg.ok || !inside) return;
    setBusy(true);
    setError(undefined);
    try {
      const f = await lib.importYouTube(c.url, seg.start, seg.end);
      onImported(f.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <motion.div ref={panel} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="scroll-mt-24">
      <Card className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="aspect-video overflow-hidden rounded-xl border border-line bg-black">
          <iframe
            key={`${c.videoId}-${seg.ok ? seg.start : 0}`}
            title={`${c.title} の埋め込みプレイヤー`}
            src={`https://www.youtube-nocookie.com/embed/${c.videoId}?rel=0${seg.ok ? `&start=${seg.start}&end=${seg.end}` : ""}`}
            className="h-full w-full"
            allow="encrypted-media; picture-in-picture"
            allowFullScreen
          />
        </div>
        <div className="space-y-4">
          <SectionTitle>この区間を取り込む</SectionTitle>
          <p className="text-xs leading-relaxed text-muted">投げている場面を {MAX_SEGMENT_SEC} 秒以内で指定します。横から全身が映った場面が向いています。</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { id: "ref-start", label: "開始", v: start, set: setStart },
              { id: "ref-end", label: "終了", v: end, set: setEnd },
            ].map((f) => (
              <div key={f.id}>
                <label htmlFor={f.id} className="mb-1 block text-xs text-muted">
                  {f.label}
                </label>
                <input id={f.id} value={f.v} onChange={(e) => f.set(e.target.value)} disabled={busy} className="w-full rounded-lg border border-line bg-ink px-3 py-2 font-mono text-sm focus:border-ice/50 focus:outline-none" />
              </div>
            ))}
          </div>
          {!seg.ok && <p className="text-xs text-flag">{seg.error}</p>}
          {seg.ok && !inside && <p className="text-xs text-flag">動画の長さ（{formatTime(c.durationSec)}）を超えています</p>}
          <Button variant="primary" className="w-full py-2.5" disabled={!seg.ok || !inside || busy} onClick={run}>
            {busy ? <IconLoader2 size={16} className="animate-spin" aria-hidden /> : <IconBrandYoutube size={16} aria-hidden />}
            {busy ? "取り込んでいます…" : "取り込んで、お手本の選手を選ぶ"}
          </Button>
          {error && <p className="text-xs text-flag">{error}</p>}
          <p className="text-[11px] leading-relaxed text-faint">区間だけを取得し、骨格と指標を出したら元の動画は消します。残すのは骨格・指標と出典だけです（ADR-0005）。</p>
        </div>
      </Card>
    </motion.div>
  );
}

function Search() {
  const { lib } = useAnalyzer();
  const navigate = useNavigate();
  const [status, setStatus] = useState<{ configured: boolean; quota: QuotaStatus | null }>();
  const [query, setQuery] = useState("");
  const [cc, setCc] = useState(false);
  const [result, setResult] = useState<YouTubeSearchResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState<string>();

  useEffect(() => {
    lib
      ?.youtubeStatus()
      .then(setStatus)
      .catch((e: Error) => setError(e.message));
  }, [lib]);

  if (!status) return <p className="text-sm text-muted">{error ?? "確かめています…"}</p>;
  if (!status.configured) return <NoKey />;

  const quota = result?.quota ?? status.quota;
  const run = async (q: string) => {
    if (!lib || !q.trim() || busy) return;
    setQuery(q);
    setBusy(true);
    setError(undefined);
    setOpen(undefined);
    try {
      setResult(await lib.searchYouTube(q.trim(), { creativeCommonsOnly: cc, max: 12 }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const opened = result?.candidates.find((c) => c.videoId === open);

  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-end justify-between gap-4 p-5">
        <form
          className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(query);
          }}
        >
          <div className="relative min-w-60 flex-1">
            <IconSearch size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-faint" aria-hidden />
            <input value={query} onChange={(e) => setQuery(e.target.value.slice(0, 100))} placeholder="QB throwing mechanics" aria-label="検索語" className="w-full rounded-lg border border-line bg-ink py-2 pr-3 pl-9 text-sm focus:border-ice/50 focus:outline-none" />
          </div>
          <Toggle on={cc} onChange={setCc}>
            Creative Commons のみ
          </Toggle>
          <Button type="submit" variant="primary" disabled={!query.trim() || busy}>
            {busy ? <IconLoader2 size={16} className="animate-spin" aria-hidden /> : <IconSearch size={16} aria-hidden />}
            探す
          </Button>
          <div className="flex w-full flex-wrap gap-1.5 pt-1">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => void run(s)} disabled={busy} className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-muted hover:border-white/20 hover:text-text">
                {s}
              </button>
            ))}
          </div>
        </form>
        {quota && <QuotaMeter quota={quota} />}
      </Card>

      {error && <p className="text-sm text-flag">{error}</p>}
      {opened && (
        <ImportPanel
          c={opened}
          onImported={(id) => navigate(`/footage/${id}/pick`)}
        />
      )}

      {result && (
        <section className="space-y-3">
          <SectionTitle right={<span className="text-[11px] text-faint">候補を押すと、埋め込みで確かめて区間を選べます</span>}>
            「{result.query}」の候補 {result.candidates.length} 件{result.creativeCommonsOnly && "（Creative Commons のみ）"}
          </SectionTitle>
          {result.candidates.length === 0 ? (
            <p className="text-sm text-muted">見つかりませんでした。言葉を変えて探してください。</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {result.candidates.map((c) => (
                <CandidateCard key={c.videoId} c={c} open={c.videoId === open} onOpen={() => setOpen(c.videoId === open ? undefined : c.videoId)} />
              ))}
            </div>
          )}
        </section>
      )}

      <p className="flex items-center gap-1.5 text-[11px] text-faint">
        <IconClock size={12} aria-hidden />
        取り込んだ映像は、本人（お手本の選手）を選んで追跡し、投球を解析すると、お手本として登録できるようにします（次の段階）。
      </p>
    </div>
  );
}

export function ReferenceSearch() {
  return (
    <div className="space-y-6">
      <PageHeader title="お手本を探す" sub="YouTube から、お手本にする投球の動画を探して、区間だけを取り込みます" />
      <PageGuide id="referenceSearch" />
      <AnalyzerGate>
        <Search />
      </AnalyzerGate>
    </div>
  );
}
