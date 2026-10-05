// 練習：まとめた映像の投球を並べて比べる。指標の平均・幅・ばらつき、リリース点の散らばり、リリースの骨格の重ね表示。
// 判定（良好・要改善）は、お手本の分布ができる M2 で出す。いまは自分の投球どうしの比較だけ。

import { IconAlertTriangle, IconArrowRight, IconLoader2, IconTarget, IconTrash } from "@tabler/icons-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { analyzeUnanalyzed, loadPractice, type PracticeView } from "../../../application/practice";
import { CAMERA_LABEL } from "../../../domain/camera";
import { formatMetric, METRIC_BY_KEY } from "../../../domain/metrics";
import { metricSpreads, PRACTICE_KIND_LABEL, releasePoint, releaseSpread, type PracticeThrow } from "../../../domain/practice";
import { mid, kp } from "../../../domain/pose";
import { isValidHeightCm, releaseFrame } from "../../../domain/throws";
import { Scatter } from "../../components/charts";
import { FieldScene, Skeleton, type Camera } from "../../components/scene";
import { Badge, Button, Card, DemoNote, PageHeader, SectionTitle, cx } from "../../components/ui";
import { PageGuide } from "../../guide/PageGuide";
import { useServices } from "../../services";
import { useAnalyzer } from "../../state/analyzer";
import { AnalyzerGate } from "./AnalyzerGate";

const GHOST_CAM: Camera = { x0: -2.0, x1: 2.0, y0: -0.15, y1: 2.1 };

/** その投球のリリースの瞬間を開く URL */
const releaseLink = (t: PracticeThrow) => `/footage/${t.footageId}?t=${(releaseFrame(t.rep) / t.fps).toFixed(2)}`;

function Summary({ view }: { view: PracticeView }) {
  const points = view.throws.map((t) => releasePoint(t.rep.sequence, t.rep.events));
  const spread = releaseSpread(points);
  const items = [
    { label: "投球", value: `${view.throws.length}`, unit: "球" },
    { label: "映像", value: `${view.entries.length}`, unit: "本" },
    { label: "リリース点のばらつき", value: spread ? spread.spread.toFixed(1) : "—", unit: spread ? "cm" : "", note: spread ? `一貫性スコア ${spread.score}（4 cm 以下で満点）` : "2 球以上で出します" },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {items.map((x) => (
        <Card key={x.label} className="p-4">
          <div className="text-[11px] text-muted">{x.label}</div>
          <div className="mt-1 font-display text-3xl leading-none">
            {x.value}
            <span className="ml-1 text-sm text-muted">{x.unit}</span>
          </div>
          {x.note && <div className="mt-2 text-[11px] text-faint">{x.note}</div>}
        </Card>
      ))}
    </div>
  );
}

function Pending({ view, heightCm, busy, error, onAnalyze }: { view: PracticeView; heightCm?: number; busy: boolean; error?: string; onAnalyze: (cm: number) => void }) {
  const [text, setText] = useState(heightCm ? String(heightCm) : "");
  if (!view.unanalyzed.length && !view.untracked.length) return null;
  const cm = Number(text);
  return (
    <Card className="space-y-3 border-caution/30 bg-caution/[0.04] p-4">
      <div className="flex items-center gap-2 text-sm text-caution">
        <IconAlertTriangle size={16} aria-hidden />
        比べられない映像があります
      </div>
      {view.untracked.length > 0 && (
        <ul className="space-y-1 text-xs text-muted">
          {view.untracked.map((f) => (
            <li key={f.id}>
              {f.name}：まだ本人を追跡していません。
              <Link to={`/footage/${f.id}/pick`} className="ml-1 text-ice hover:underline">
                本人を選ぶ
              </Link>
            </li>
          ))}
        </ul>
      )}
      {view.unanalyzed.length > 0 && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (isValidHeightCm(cm) && !busy) onAnalyze(cm);
          }}
        >
          <p className="w-full text-xs text-muted">投球をまだ解析していない映像が {view.unanalyzed.length} 本あります（{view.unanalyzed.map((f) => f.name).join("、")}）。同じ身長でまとめて解析します。</p>
          <div>
            <label htmlFor="practice-height" className="mb-1 block text-xs text-muted">
              身長（cm）
            </label>
            <input id="practice-height" type="number" inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} placeholder="180" disabled={busy} className="w-28 rounded-lg border border-line bg-ink px-3 py-2 font-mono text-sm focus:border-ice/50 focus:outline-none" />
          </div>
          <Button type="submit" variant="primary" disabled={!isValidHeightCm(cm) || busy}>
            {busy ? <IconLoader2 size={16} className="animate-spin" aria-hidden /> : <IconTarget size={16} aria-hidden />}
            まとめて解析する
          </Button>
          {error && <span className="text-xs text-flag">{error}</span>}
        </form>
      )}
    </Card>
  );
}

function MetricTable({ view, selected, onSelect }: { view: PracticeView; selected: number; onSelect: (order: number) => void }) {
  const spreads = metricSpreads(view.throws);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[11px] text-muted">
            <th className="py-2 pr-3 font-normal">指標</th>
            {view.throws.map((t) => (
              <th key={t.order} className="px-2 py-2 text-right font-normal">
                <button type="button" onClick={() => onSelect(t.order)} className={cx("rounded px-1.5 py-0.5 hover:text-text", t.order === selected && "bg-turf/15 text-turf")} title={`${t.footageName} の #${t.rep.index}`}>
                  #{t.order}
                </button>
              </th>
            ))}
            <th className="px-2 py-2 text-right font-normal">平均</th>
            <th className="px-2 py-2 text-right font-normal">幅</th>
            <th className="py-2 pl-2 text-right font-normal">標準偏差</th>
          </tr>
        </thead>
        <tbody>
          {spreads.map((s) => {
            const d = METRIC_BY_KEY[s.key];
            return (
              <tr key={s.key} className="border-b border-line/60">
                <td className="py-2 pr-3">
                  <div>{d.short}</div>
                  <div className="text-[10px] text-faint">{d.unit || "比"}</div>
                </td>
                {s.values.map((v, i) => (
                  <td key={i} className={cx("px-2 py-2 text-right font-mono text-xs", view.throws[i]!.order === selected ? "text-turf" : "text-text/85")}>
                    {v === undefined ? "—" : v.toFixed(d.digits)}
                  </td>
                ))}
                <td className="px-2 py-2 text-right font-mono text-xs">{formatMetric(s.key, s.mean)}</td>
                <td className="px-2 py-2 text-right font-mono text-xs text-muted">{s.n > 1 ? `${s.min.toFixed(d.digits)}〜${s.max.toFixed(d.digits)}` : "—"}</td>
                <td className="py-2 pl-2 text-right font-mono text-xs text-muted">{s.n > 1 ? s.sd.toFixed(d.digits + 1) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** リリースの瞬間の骨格を、骨盤の位置をそろえて重ねる。選んだ投球を緑、ほかを薄い青で描く */
function ReleaseGhosts({ throws, selected }: { throws: PracticeThrow[]; selected: number }) {
  const frames = throws.map((t) => {
    const f = t.rep.sequence.frames[t.rep.events.release]!;
    const pelvis = mid(kp(f, "lHip"), kp(f, "rHip"));
    return { order: t.order, frame: f, offset: { x: -pelvis.x, y: 0 } };
  });
  const order = [...frames.filter((f) => f.order !== selected), ...frames.filter((f) => f.order === selected)];
  return (
    <FieldScene cam={GHOST_CAM} className="block w-full rounded-xl">
      {order.map((f) => (
        <Skeleton key={f.order} frame={f.frame} cam={GHOST_CAM} offset={f.offset} variant={f.order === selected ? "self" : "ghost"} joints={f.order === selected} />
      ))}
    </FieldScene>
  );
}

function Practice({ onTitle }: { onTitle: (name: string) => void }) {
  const { id = "" } = useParams();
  const { lib } = useAnalyzer();
  const { profile } = useServices();
  const navigate = useNavigate();
  const [view, setView] = useState<PracticeView>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string>();
  const [selected, setSelected] = useState(1);

  useEffect(() => {
    if (!lib) return;
    loadPractice(lib, id)
      .then((v) => {
        setView(v);
        onTitle(v.practice.name);
      })
      .catch((e: Error) => setError(e.message));
  }, [lib, id, onTitle]);

  const points = useMemo(() => view?.throws.map((t) => releasePoint(t.rep.sequence, t.rep.events)) ?? [], [view]);

  if (error) return <p className="text-sm text-flag">{error}</p>;
  if (!view || !lib) return <p className="text-sm text-muted">読み込んでいます…</p>;

  const p = view.practice;
  const current = view.throws.find((t) => t.order === selected) ?? view.throws[0];
  const analyze = async (cm: number) => {
    setBusy(true);
    setAnalyzeError(undefined);
    try {
      profile.saveHeightCm(cm);
      setView(await analyzeUnanalyzed(lib, view, cm));
    } catch (e) {
      setAnalyzeError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!window.confirm(`練習「${p.name}」を消します。まとめた映像と解析結果は残ります。よろしいですか？`)) return;
    await lib.deletePractice(p.id);
    navigate("/footage");
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <Badge tone="turf">{PRACTICE_KIND_LABEL[p.kind]}</Badge>
        <Badge>{CAMERA_LABEL[p.camera]}</Badge>
        <span className="font-mono">{p.date}</span>
        {p.memo && <span className="text-faint">· {p.memo}</span>}
        <Button variant="ghost" className="ml-auto text-xs" onClick={remove}>
          <IconTrash size={14} aria-hidden /> 練習を消す
        </Button>
      </div>

      <Summary view={view} />
      <Pending view={view} heightCm={profile.heightCm()} busy={busy} error={analyzeError} onAnalyze={analyze} />

      {view.throws.length > 0 && current && (
        <>
          <Card className="space-y-3 p-5">
            <SectionTitle right={<span className="text-[11px] text-faint">列の番号を押すと、その投球を選べます</span>}>投球ごとの指標</SectionTitle>
            <MetricTable view={view} selected={current.order} onSelect={setSelected} />
          </Card>

          <div className="grid gap-5 xl:grid-cols-2">
            <Card className="space-y-3 p-5">
              <SectionTitle>リリースの骨格を重ねる</SectionTitle>
              <ReleaseGhosts throws={view.throws} selected={current.order} />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-muted">
                  <span className="text-turf">#{current.order}</span>（{current.footageName} の #{current.rep.index}）を緑、ほかを薄い青で描いています。骨盤の位置をそろえています
                </span>
                <Link to={releaseLink(current)} className="inline-flex items-center gap-1 text-ice hover:underline">
                  映像で見る <IconArrowRight size={13} aria-hidden />
                </Link>
              </div>
            </Card>
            <Card className="space-y-3 p-5">
              <SectionTitle>リリース点の散らばり</SectionTitle>
              {points.length > 1 ? (
                <Scatter groups={[{ label: "この練習", color: "#2EE59D", points }]} xLabel="接地時の後ろ足からの前後位置（cm）" yLabel="リリース点の高さ（cm）" />
              ) : (
                <p className="text-sm text-muted">2 球以上あると、散らばりを出します。</p>
              )}
              <p className="text-[11px] leading-relaxed text-faint">点が集まっているほど、毎回同じ位置でボールを離せています。破線の円は平均の位置です。</p>
            </Card>
          </div>

          <Card className="p-5">
            <SectionTitle>投球の一覧</SectionTitle>
            <ul className="divide-y divide-line/60 text-sm">
              {view.throws.map((t, i) => (
                <motion.li key={t.order} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="flex items-center gap-3 py-2">
                  <span className="w-8 font-display text-turf">#{t.order}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {t.footageName} <span className="text-muted">の #{t.rep.index}</span>
                  </span>
                  <span className="font-mono text-xs text-muted">リリース {(releaseFrame(t.rep) / t.fps).toFixed(2)}s</span>
                  <Link to={releaseLink(t)} className="text-xs text-ice hover:underline">
                    映像で見る
                  </Link>
                </motion.li>
              ))}
            </ul>
          </Card>
        </>
      )}

      <DemoNote>お手本との比較と判定（良好・要改善）は、お手本ライブラリ（M2）でお手本の分布ができたら出します。いまは自分の投球どうしを比べています。</DemoNote>
    </div>
  );
}

export function PracticePage() {
  const [title, setTitle] = useState("練習");
  return (
    <div className="space-y-6">
      <PageHeader title={`練習：${title}`} sub="まとめた映像の投球を並べて、ばらつきを比べます" />
      <PageGuide id="practice" />
      <AnalyzerGate>
        <Practice onTitle={setTitle} />
      </AnalyzerGate>
    </div>
  );
}
