import { IconBrandYoutube, IconEyeOff, IconLoader2, IconMovie, IconPin, IconRefresh, IconSearch, IconStar, IconTrash } from "@tabler/icons-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { CAMERA_LABEL } from "../../domain/camera";
import { KIND_LABEL, type Reference, type ReferenceKind } from "../../domain/entities";
import { isValidFor, METRIC_BY_KEY, METRICS, type MetricKey } from "../../domain/metrics";
import { APPROACH_GROUPS, APPROACH_LABEL, type Approach, type ApproachGroup } from "../../domain/throws";
import { popularity, weightedQuantile } from "../../domain/weighting";
import { FactorBars, Histogram } from "../components/charts";
import { FieldScene, Skeleton } from "../components/scene";
import { Badge, Button, Card, DemoNote, PageHeader, SectionTitle, Segmented, Toggle, cx } from "../components/ui";
import { usePlayback } from "../hooks/usePlayback";
import { PageGuide } from "../guide/PageGuide";
import { useAnalyzer } from "../state/analyzer";
import { DrillList } from "./drills";
import { useDemoLibrary, useLocalLibrary, type LibraryView } from "../state/library";

const compact = (n: number) => new Intl.NumberFormat("ja-JP", { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** お手本の投げ始め（レップごとの重なりを除く）。デモの合成データは持たない */
const approachesOf = (r: Reference): Approach[] => [...new Set(r.reps.map((x) => x.approach).filter((a): a is Approach => a !== undefined))];

export function References() {
  const analyzer = useAnalyzer();
  const demo = useDemoLibrary();
  const local = useLocalLibrary();
  const localCount = local.view?.refs.length ?? 0;
  // 手元のお手本があれば、そちらを先に出す
  const [source, setSource] = useState<"demo" | "local">();
  const current = source ?? (localCount > 0 ? "local" : "demo");
  const view: LibraryView = current === "local" && local.view ? local.view : demo;
  const { manual, reset, changed } = view;
  const refs = view.refs;
  const [query, setQuery] = useState("");
  const [ccOnly, setCcOnly] = useState(false);
  const [kind, setKind] = useState<"all" | ReferenceKind>("all");
  const [selectedId, setSelectedId] = useState<string>();
  const [metric, setMetric] = useState<MetricKey>("strideRatio");

  const list = refs.filter((r) => {
    if (ccOnly && !r.creativeCommons) return false;
    if (kind !== "all" && r.kind !== kind) return false;
    const q = query.trim().toLowerCase();
    return !q || [r.title, r.channel, ...r.tags].some((t) => t.toLowerCase().includes(q));
  });
  const selected = refs.find((r) => r.id === selectedId) ?? refs[0];
  const maxW = Math.max(1e-6, ...Object.values(view.weights.overall));

  return (
    <div className="space-y-6">
      <PageHeader
        title="お手本ライブラリ"
        sub="YouTube のお手本を取り込み、人気度・発信者・解析品質・合意度・手動調整で重み付けします"
        right={
          <span className="flex flex-wrap items-center gap-2">
            {analyzer.status === "online" && (
              <Segmented
                label="お手本の出どころ"
                size="sm"
                value={current}
                onChange={setSource}
                options={[
                  { value: "local", label: local.loading ? "手元のお手本…" : `手元のお手本（${localCount}）` },
                  { value: "demo", label: "デモ" },
                ]}
              />
            )}
            {changed && (
              <Button variant="ghost" onClick={reset}>
                <IconRefresh size={15} aria-hidden /> 手動調整を元に戻す
              </Button>
            )}
            {analyzer.status === "online" && (
              <Link to="/references/search">
                <Button variant="primary">
                  <IconBrandYoutube size={15} aria-hidden /> YouTube で探す
                </Button>
              </Link>
            )}
          </span>
        }
      />

      <PageGuide id="references" />
      {local.error && current === "local" && <p className="text-sm text-flag">{local.error}</p>}
      {current === "local" && !selected ? (
        <Card className="max-w-2xl space-y-3 p-6">
          <h2 className="font-semibold">手元のお手本はまだありません</h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed text-muted">
            <li>「YouTube で探す」で候補を探し、投げている場面を区間で取り込む</li>
            <li>お手本の選手を選んで追跡し、「見る」画面で選手の身長を入れて投球を解析する</li>
            <li>「見る」画面の「お手本として登録」で登録する</li>
          </ol>
          <Link to="/references/search" className="inline-block">
            <Button variant="primary">
              <IconBrandYoutube size={15} aria-hidden /> YouTube で探す
            </Button>
          </Link>
        </Card>
      ) : selected ? (
        <>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        {/* 一覧 */}
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-60 flex-1">
              <IconSearch size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="QB throwing mechanics"
                aria-label="お手本を検索"
                className="w-full rounded-lg border border-line bg-panel py-2 pr-3 pl-9 text-sm placeholder:text-faint focus:border-ice/50 focus:outline-none"
              />
            </div>
            <Segmented
              label="種類"
              size="sm"
              value={kind}
              onChange={setKind}
              options={[
                { value: "all", label: "すべて" },
                { value: "model", label: KIND_LABEL.model },
                { value: "drill", label: KIND_LABEL.drill },
              ]}
            />
            <Toggle on={ccOnly} onChange={setCcOnly} tone="ice">
              Creative Commons のみ
            </Toggle>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {list.map((r) => {
              const w = view.weights.overall[r.id] ?? 0;
              const m = manual[r.id]!;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedId(r.id)}
                  className={cx("card flex gap-3 p-3 text-left transition-colors hover:border-line-strong", r.id === selected.id && "border-ice/50 bg-raised", m.excluded && "opacity-50")}
                >
                  <RefThumb r={r} />
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-sm leading-snug">{r.title}</div>
                    <div className="mt-1 truncate text-xs text-muted">{r.channel}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <Badge>{CAMERA_LABEL[r.stats.camera]}</Badge>
                      {approachesOf(r).map((a) => (
                        <Badge key={a} tone={a === "unknown" ? undefined : "ice"}>
                          {APPROACH_LABEL[a]}
                        </Badge>
                      ))}
                      {r.creativeCommons && <Badge tone="ice">CC</Badge>}
                      {m.pinned && (
                        <Badge tone="pylon">
                          <IconPin size={11} aria-hidden /> ピン
                        </Badge>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                        <motion.div className="h-full rounded-full bg-turf" animate={{ width: `${(w / maxW) * 100}%` }} />
                      </div>
                      <span className="font-mono text-[11px] text-turf">{w.toFixed(2)}</span>
                    </div>
                  </div>
                </button>
              );
            })}
            {list.length === 0 && <p className="text-sm text-muted">条件に合うお手本はありません。検索語やフィルタを変えてください。</p>}
          </div>
          {view.source === "demo" ? (
            <DemoNote>チャンネル・動画はすべて架空のデモデータです。手元の解析サービスにつなぐと、「YouTube で探す」で取り込んだお手本を使えます。</DemoNote>
          ) : (
            local.library?.broken.length ? (
              <p className="text-xs text-caution">元の映像か投球の解析結果が読めないお手本が {local.library.broken.length} 件あります（{local.library.broken.map((b) => b.title).join("、")}）。</p>
            ) : null
          )}
        </div>

        {/* 詳細 */}
        <ReferenceDetail key={`${view.source}-${selected.id}`} view={view} r={selected} metric={metric} setMetric={setMetric} />
      </div>

      <Distribution view={view} metric={metric} setMetric={setMetric} />
      {view.source === "local" && <DrillList />}
        </>
      ) : null}
    </div>
  );
}

function RefThumb({ r }: { r: Reference }) {
  const rep = r.reps[0]!;
  return (
    <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg border border-line">
      <FieldScene className="block h-full w-full" cam={{ x0: -2.4, x1: 0.2, y0: -0.1, y1: 2.05 }}>
        <Skeleton frame={rep.seq.frames[rep.events.release]!} variant="ref" cam={{ x0: -2.4, x1: 0.2, y0: -0.1, y1: 2.05 }} joints={false} width={1.4} />
      </FieldScene>
      <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 font-mono text-[10px]">{r.duration}</span>
      <IconBrandYoutube size={14} className="absolute top-1 left-1 text-flag" aria-hidden />
    </div>
  );
}

function ReferenceDetail({ view, r, metric, setMetric }: { view: LibraryView; r: Reference; metric: MetricKey; setMetric: (k: MetricKey) => void }) {
  const manual = view.manual[r.id]!;
  const update = (p: Partial<typeof manual>) => view.update(r.id, p);
  const record = view.local?.records[r.id];
  const [busy, setBusy] = useState<"refresh" | "remove">();
  const [error, setError] = useState<string>();
  const act = async (kind: "refresh" | "remove", run: () => Promise<void>) => {
    setBusy(kind);
    setError(undefined);
    try {
      await run();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  const rep = r.reps[0]!;
  const pb = usePlayback(rep.seq.frames.length, rep.seq.fps, { autoplay: true, initialRate: 0.5 });
  const parts = view.weights.parts[r.id]?.[metric];
  const pop = popularity(r.stats);
  const def = METRIC_BY_KEY[metric];
  const valid = isValidFor(def, r.stats.camera);
  const measured = r.reps.some((x) => x.metrics[metric] !== undefined);
  const metricOptions = METRICS.filter((m) => m.key !== "headStability" && m.key !== "releaseTime").slice(0, 6);

  return (
    <Card className="space-y-5 p-5" data-tour="references-detail">
      <div className="overflow-hidden rounded-xl border border-line">
        <FieldScene className="block w-full">
          <Skeleton frame={rep.seq.frames[pb.frame]!} variant="ref" />
        </FieldScene>
      </div>
      <div>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base leading-snug font-semibold">{r.title}</h2>
          <Badge tone={r.kind === "drill" ? "ice" : "turf"}>{KIND_LABEL[r.kind]}</Badge>
        </div>
        <div className="mt-1 text-xs text-muted">
          {r.channel} · {r.publishedAt} · 区間 {r.segment.start}〜{r.segment.end}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[
            { label: "再生数", v: compact(r.stats.views) },
            { label: "高評価率（補正後）", v: `${(pop.bayesRate * 100).toFixed(1)}%` },
            { label: "登録者数", v: compact(r.stats.subscribers) },
          ].map((s) => (
            <div key={s.label} className="rounded-lg bg-white/[0.03] px-2 py-2">
              <div className="font-display text-xl">{s.v}</div>
              <div className="text-[10px] text-muted">{s.label}</div>
            </div>
          ))}
        </div>
        {record ? (
          <div className="mt-3 space-y-2">
            <p className="text-[11px] leading-relaxed text-faint">
              統計は {new Date(record.stats.fetchedAt).toLocaleString("ja-JP")} に取得しました。お手本の選手の身長 {record.playerHeightCm} cm で解析しています。元の動画は解析のあとに消し、骨格・指標と出典だけを残しています。
            </p>
            <div className="flex flex-wrap gap-2">
              <Link to={`/footage/${record.videoId}`}>
                <Button>
                  <IconMovie size={14} aria-hidden /> 映像で見る
                </Button>
              </Link>
              <Button onClick={() => void act("refresh", () => view.local!.refresh(r.id))} disabled={busy !== undefined} title="YouTube Data API の無料枠を 2 ユニット使います">
                {busy === "refresh" ? <IconLoader2 size={14} className="animate-spin" aria-hidden /> : <IconRefresh size={14} aria-hidden />} 統計を取り直す
              </Button>
              <Button
                variant="ghost"
                onClick={() => window.confirm(`「${r.title}」をお手本から外します。元の映像と解析結果は残ります。よろしいですか？`) && void act("remove", () => view.local!.remove(r.id))}
                disabled={busy !== undefined}
              >
                <IconTrash size={14} aria-hidden /> お手本から外す
              </Button>
            </div>
            {error && <p className="text-xs text-flag">{error}</p>}
          </div>
        ) : (
          <p className="mt-3 text-[11px] leading-relaxed text-faint">元の動画は保持せず、骨格・指標と出典だけを残しています。表示は YouTube の埋め込みプレイヤーで行います（架空の動画のためデモでは骨格のみ）。</p>
        )}
      </div>

      <div>
        <SectionTitle>重みの内訳</SectionTitle>
        <div className="mb-3 flex flex-wrap gap-1">
          {metricOptions.map((m) => (
            <button key={m.key} type="button" onClick={() => setMetric(m.key)} className={cx("rounded-md border px-2 py-0.5 text-[11px]", m.key === metric ? "border-ice/50 bg-ice/10 text-ice" : "border-line text-muted hover:text-text")}>
              {m.short}
            </button>
          ))}
        </div>
        <FactorBars parts={parts} />
        <p className="mt-3 text-xs leading-relaxed text-muted">
          {!valid
            ? `${CAMERA_LABEL[r.stats.camera]}の映像なので、「${def.short}」には使いません（Q = 0）。`
            : !measured
              ? `この映像では「${def.short}」を測れていないため、使っていません（ステップの前が映っていない など）。`
              : parts && parts.K < 0.35
              ? `「${def.short}」の値が他のお手本から大きく外れているため、合意度 K で重みを下げています。`
              : `${CAMERA_LABEL[r.stats.camera]}の映像で、「${def.short}」の判定に使っています。`}
        </p>
      </div>

      <div>
        <SectionTitle>手動調整</SectionTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Toggle on={manual.pinned} onChange={(v) => update({ pinned: v })} tone="pylon">
            <IconPin size={13} aria-hidden /> ピン留め（×1.5）
          </Toggle>
          <Toggle on={manual.excluded} onChange={(v) => update({ excluded: v })} tone="pylon">
            <IconEyeOff size={13} aria-hidden /> 除外
          </Toggle>
          <div className="ml-auto flex items-center" role="radiogroup" aria-label="星評価">
            {([1, 2, 3, 4, 5] as const).map((n) => (
              <button key={n} type="button" role="radio" aria-checked={manual.stars === n} aria-label={`星 ${n}`} onClick={() => update({ stars: n })} className="p-0.5">
                <IconStar size={17} className={n <= manual.stars ? "fill-caution text-caution" : "text-faint"} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function Distribution({ view, metric, setMetric }: { view: LibraryView; metric: MetricKey; setMetric: (k: MetricKey) => void }) {
  const [popularityOnly, setPopularityOnly] = useState(false);
  const [group, setGroup] = useState<ApproachGroup>("drop");
  const def = METRIC_BY_KEY[metric];
  // 投げ始めで意味が変わる指標は、投げ始めが同じお手本だけで分布を作る（判定と同じ）
  const split = def.byApproach && view.byApproach ? group : undefined;
  const weights = split ? view.byApproach![split] : view.weights;
  const refs = view.refs;
  const unknown = split ? refs.flatMap((r) => r.reps).filter((x) => x.approach === "unknown" && x.metrics[metric] !== undefined).length : 0;

  const samples = useMemo(
    () =>
      refs.flatMap((r) =>
        r.reps
          .filter((x) => !split || x.approach === split)
          .map((x) => ({ ref: r.id, value: x.metrics[metric], weight: weights.samples[x.id]?.[metric]?.w ?? 0, P: weights.samples[x.id]?.[metric]?.P ?? 0, Q: weights.samples[x.id]?.[metric]?.Q ?? 0 }))
          .filter((s): s is { ref: string; value: number; weight: number; P: number; Q: number } => s.value !== undefined),
      ),
    [refs, weights, metric, split],
  );
  const videos = new Set(samples.map((s) => s.ref)).size;
  // 比較用：人気度だけで重み付けした場合のゾーン（撮影角度が合わないものは同じく除く）
  const popZone = useMemo(() => {
    const vs = samples.map((s) => s.value);
    const ws = samples.map((s) => (s.Q > 0 ? s.P : 0));
    const q = (p: number) => weightedQuantile(vs, ws, p)!;
    return ws.some((w) => w > 0) ? { p10: q(0.1), p25: q(0.25), p50: q(0.5), p75: q(0.75), p90: q(0.9) } : undefined;
  }, [samples]);
  const zone = weights.zones[metric];
  const you = view.you(metric);
  const used = samples.filter((s) => s.weight > 0).length;

  return (
    <Card className="p-5">
      <SectionTitle
        right={
          <Toggle on={popularityOnly} onChange={setPopularityOnly} tone="pylon">
            人気度だけで重み付けした場合と比べる
          </Toggle>
        }
      >
        お手本の分布
      </SectionTitle>
      <div className="mb-4 flex flex-wrap gap-1">
        {METRICS.map((m) => (
          <button key={m.key} type="button" onClick={() => setMetric(m.key)} className={cx("rounded-md border px-2 py-0.5 text-xs", m.key === metric ? "border-ice/50 bg-ice/10 text-ice" : "border-line text-muted hover:text-text")}>
            {m.short}
          </button>
        ))}
      </div>
      {split && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-white/[0.02] px-3 py-2">
          <Segmented label="投げ始め" size="sm" value={group} onChange={setGroup} options={APPROACH_GROUPS.map((g) => ({ value: g, label: APPROACH_LABEL[g] }))} />
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-muted">
            「{def.short}」はドロップの有無で値の意味が変わるため、投げ始めが同じお手本だけで分布を作り、自分の投球も投げ始めが同じものとだけ比べます。
            {unknown > 0 && `投げ始めの分からないお手本（${unknown} レップ）は入れていません。`}
          </p>
        </div>
      )}
      {samples.length ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
          <Histogram samples={samples} zone={zone} you={you} best={view.best?.[metric]} digits={def.digits} compareZone={popularityOnly ? popZone : undefined} />
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted">お手本ゾーン（重み付き四分位）</dt>
              <dd className="font-mono text-ice">{zone ? `${zone.p25.toFixed(def.digits)}〜${zone.p75.toFixed(def.digits)}${def.unit}` : "—"}</dd>
            </div>
            {popularityOnly && (
              <div>
                <dt className="text-xs text-muted">人気度だけの場合</dt>
                <dd className="font-mono text-caution">{popZone ? `${popZone.p25.toFixed(def.digits)}〜${popZone.p75.toFixed(def.digits)}${def.unit}` : "—"}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-muted">使った標本</dt>
              <dd>
                {used} / {samples.length} レップ（{videos} 本の動画）
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">今回のあなた</dt>
              <dd className="font-mono text-pylon">{you !== undefined ? `${you.toFixed(def.digits)}${def.unit}` : view.source === "local" ? "「見る」・練習の画面で比べます" : "判定不可"}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <p className="text-sm text-muted">{split ? `投げ始めが「${APPROACH_LABEL[split]}」のお手本で、この指標を測れたものがありません。` : "この指標を測れるお手本がありません。"}</p>
      )}
    </Card>
  );
}
