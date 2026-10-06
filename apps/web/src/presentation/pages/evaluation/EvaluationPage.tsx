// 精度の評価：自分の映像に、関節の位置と接地・リリースの瞬間の正解を手で付け、解析の結果と比べる。
// 誤差の計算は解析サービスが行う（domain/evaluation.py）。正解は data/annotations/ に保存し、リポジトリには入れない。

import { IconCheck, IconLoader2 } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { progressOf, type AnnotationInput, type Evaluation, type EvaluationTarget, type EvaluationThrow } from "../../../domain/evaluation";
import { Button, Card, PageHeader, SectionTitle, cx } from "../../components/ui";
import { PageGuide } from "../../guide/PageGuide";
import { useAnalyzer } from "../../state/analyzer";
import { AnalyzerGate } from "../footage/AnalyzerGate";
import { Annotator, type Step } from "./Annotator";
import { Results } from "./Results";

const EMPTY: AnnotationInput = { throws: [], frames: [] };

/** 正解を付けるフレーム：解析サービスが返したもの（区間の 25・50・75% と保存済みの瞬間）に、まだ保存していない瞬間を足す */
function framesOf(t: EvaluationThrow, draft: AnnotationInput): EvaluationThrow {
  const label = draft.throws.find((x) => x.rep === t.rep);
  const extra = [label?.plant, label?.release].filter((x): x is number => x != null);
  return { ...t, frames: [...new Set([...t.frames, ...extra])].sort((a, b) => a - b) };
}

function Targets({ data, drafts, onOpen }: { data: Evaluation; drafts: Record<string, AnnotationInput>; onOpen: (videoId: string, rep: number, step: Step) => void }) {
  return (
    <Card className="p-5">
      <SectionTitle>正解を付ける映像</SectionTitle>
      {data.targets.length === 0 ? (
        <p className="text-sm text-muted">正解を付けられる映像がありません。「自分の映像」で取り込み、本人を追跡して投球を解析した映像に付けられます。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] text-muted">
                <th className="py-2 pr-3 font-normal">映像</th>
                <th className="px-2 py-2 font-normal">投球</th>
                <th className="px-2 py-2 font-normal">① 瞬間</th>
                <th className="px-2 py-2 font-normal">② 関節</th>
                <th className="py-2 pl-2" />
              </tr>
            </thead>
            <tbody>
              {data.targets.flatMap((t) =>
                t.throws.map((x) => {
                  const draft = drafts[t.video.id] ?? EMPTY;
                  const p = progressOf({ ...t, throws: [framesOf(x, draft)] }, draft);
                  const eventsDone = p.events === 1;
                  const jointsDone = p.frames === p.framesTotal;
                  return (
                    <tr key={`${t.video.id}-${x.rep}`} className="border-b border-line/60">
                      <td className="py-2 pr-3">
                        <div>{t.video.name}</div>
                        <div className="text-[10px] text-faint">
                          {t.video.fps.toFixed(0)} fps · {t.video.width}×{t.video.height} · {t.hand === "right" ? "右投げ" : "左投げ"}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-muted">{x.rep}</td>
                      <td className={cx("px-2 py-2", eventsDone ? "text-turf" : "text-muted")}>{eventsDone ? <IconCheck size={15} aria-label="済み" /> : "未"}</td>
                      <td className={cx("px-2 py-2 font-mono text-xs", jointsDone ? "text-turf" : "text-muted")}>
                        {p.frames} / {p.framesTotal} 枚
                      </td>
                      <td className="py-2 pl-2 text-right whitespace-nowrap">
                        <Button variant="ghost" onClick={() => onOpen(t.video.id, x.rep, "events")}>
                          瞬間を付ける
                        </Button>
                        <Button variant="ghost" onClick={() => onOpen(t.video.id, x.rep, "joints")}>
                          関節を付ける
                        </Button>
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

const fromServer = (t: EvaluationTarget): AnnotationInput => (t.annotation ? { throws: t.annotation.throws, frames: t.annotation.frames } : EMPTY);

function Workspace() {
  const { lib } = useAnalyzer();
  const [data, setData] = useState<Evaluation>();
  const [drafts, setDrafts] = useState<Record<string, AnnotationInput>>({});
  const [open, setOpen] = useState<{ videoId: string; rep: number; step: Step }>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  /** まだ保存していない正解（映像ごと） */
  const pending = useRef<Record<string, AnnotationInput>>({});
  /** 送っている途中の保存（映像ごと）。順に送り、前の保存が後から届いて新しい正解を上書きしないようにする */
  const queue = useRef<Record<string, Promise<void>>>({});
  /** 映像ごとの、最後に正解を変えた時刻 */
  const edited = useRef<Record<string, number>>({});
  const loads = useRef(0);

  const load = useCallback(async () => {
    if (!lib) return;
    const id = ++loads.current;
    const started = Date.now();
    setLoading(true);
    try {
      const e = await lib.evaluation();
      // 後から始めた読み込みがあれば、そちらに任せる
      if (id !== loads.current) return;
      setData(e);
      // 読み込みのあいだに付けた正解（まだ保存していないもの）は、読み込んだ正解で上書きしない
      setDrafts((prev) =>
        Object.fromEntries(
          e.targets.map((t) => {
            const v = t.video.id;
            const keep = prev[v] && (v in pending.current || (edited.current[v] ?? 0) >= started);
            return [v, keep ? prev[v]! : fromServer(t)];
          }),
        ),
      );
      setError(undefined);
    } catch (err) {
      if (id === loads.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (id === loads.current) setLoading(false);
    }
  }, [lib]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = (videoId: string): Promise<void> => {
    const next = pending.current[videoId];
    if (!next) return queue.current[videoId] ?? Promise.resolve();
    delete pending.current[videoId];
    setSaving(true);
    const job = (queue.current[videoId] ?? Promise.resolve()).then(async () => {
      try {
        await lib!.saveAnnotation(videoId, next);
        setError(undefined);
      } catch (err) {
        setError(`保存できませんでした：${err instanceof Error ? err.message : String(err)}`);
      }
    });
    queue.current[videoId] = job;
    void job.then(() => {
      if (queue.current[videoId] !== job) return;
      delete queue.current[videoId];
      if (Object.keys(queue.current).length === 0) setSaving(false);
    });
    return job;
  };

  /** 待っている保存をすぐに送り、送っている途中の保存とあわせて、終わるまで待つ */
  const flush = async () => {
    for (const t of Object.values(timers.current)) clearTimeout(t);
    timers.current = {};
    for (const v of Object.keys(pending.current)) void save(v);
    await Promise.all(Object.values(queue.current));
  };

  // 付けた正解は、少し待ってからまとめて保存する（クリックのたびに送らない）
  const change = (videoId: string, next: AnnotationInput) => {
    setDrafts((d) => ({ ...d, [videoId]: next }));
    pending.current[videoId] = next;
    edited.current[videoId] = Date.now();
    clearTimeout(timers.current[videoId]);
    timers.current[videoId] = setTimeout(() => void save(videoId), 400);
  };

  const refresh = async () => {
    await flush();
    await load();
  };

  if (!data) {
    return error ? (
      <p className="text-sm text-flag">{error}</p>
    ) : (
      <p className="flex items-center gap-2 text-sm text-muted">
        <IconLoader2 size={15} className="animate-spin" aria-hidden /> 読み込んでいます…
      </p>
    );
  }
  const target: EvaluationTarget | undefined = open && data.targets.find((t) => t.video.id === open.videoId);
  const t = target && open && target.throws.find((x) => x.rep === open.rep);
  const draft = (open && drafts[open.videoId]) ?? EMPTY;
  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-flag">{error}</p>}
      {target && t && open ? (
        <Annotator
          target={target}
          t={framesOf(t, draft)}
          step={open.step}
          setStep={(step) => setOpen({ ...open, step })}
          draft={draft}
          onChange={(a) => change(target.video.id, a)}
          onClose={() => {
            setOpen(undefined);
            // 保存を済ませてから、付けた正解で計算し直す
            void refresh();
          }}
          saving={saving}
        />
      ) : (
        <Targets data={data} drafts={drafts} onOpen={(videoId, rep, step) => setOpen({ videoId, rep, step })} />
      )}
      <Results data={data} onRefresh={() => void refresh()} busy={loading} />
    </div>
  );
}

export function EvaluationPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="精度の評価" sub="手で付けた正解と比べて、骨格・瞬間・指標の誤差を測ります" />
      <PageGuide id="evaluation" />
      <AnalyzerGate>
        <Workspace />
      </AnalyzerGate>
    </div>
  );
}
