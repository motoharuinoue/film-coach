// ドリル動画の登録（「YouTube で探す」の候補から）と一覧（お手本ライブラリ）。
// 動画は取り込まず、YouTube の動画 ID と開始位置、どの指標をどちら側に外れたときに直すドリルかだけを残す（ADR-0005）。

import { IconCheck, IconExternalLink, IconLoader2, IconTrash, IconVideoPlus } from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";
import { DRILL_LIMITS, DRILL_SIDE_SHORT, drillUrl, type DrillSide } from "../../domain/drill";
import { METRIC_BY_KEY, METRICS, type MetricKey } from "../../domain/metrics";
import { formatTime, parseTime, type YouTubeCandidate } from "../../domain/youtube";
import { Badge, Button, Card, SectionTitle } from "../components/ui";
import { useLocalData } from "../state/local";

const SIDES: DrillSide[] = ["low", "high", "any"];

/** 候補の動画を、ドリル動画として登録する。開始位置は埋め込みプレイヤーにも反映する */
export function DrillForm({ c, start, onStart }: { c: YouTubeCandidate; start: string; onStart: (v: string) => void }) {
  const { addDrill } = useLocalData();
  const [label, setLabel] = useState("");
  const [sides, setSides] = useState<Partial<Record<MetricKey, DrillSide>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const startSec = parseTime(start);
  const targets = METRICS.filter((m) => sides[m.key]).map((m) => ({ metric: m.key, side: sides[m.key]! }));
  const name = label.trim();
  const problem =
    !name || name.length > DRILL_LIMITS.label
      ? `ドリルの名前を 1〜${DRILL_LIMITS.label} 文字で入れてください`
      : startSec === undefined
        ? "開始位置は 1:35 のような形で入れてください"
        : c.durationSec > 0 && startSec >= c.durationSec
          ? `動画の長さ（${formatTime(c.durationSec)}）より前にしてください`
          : targets.length === 0
            ? "直す指標を 1 つ以上選んでください"
            : undefined;

  const run = async () => {
    if (problem || startSec === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      const d = await addDrill({ youtubeId: c.videoId, title: c.title, channel: c.channel, startSec, label: name, targets });
      setDone(d.label);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="space-y-3 text-sm">
        <p className="flex items-center gap-2 text-turf">
          <IconCheck size={16} aria-hidden />「{done}」を登録しました
        </p>
        <p className="text-xs leading-relaxed text-muted">選んだ指標がお手本の範囲から外れたとき、改善点（ホーム・レポート）にこのドリル動画を添えます。</p>
        <Link to="/references" className="text-xs text-ice hover:underline">
          お手本ライブラリでドリル動画を見る
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-muted">練習ドリルを解説している動画を、改善点に添えます。動画は取り込まず、YouTube で開くだけです。</p>
      <div className="grid grid-cols-[1fr_88px] gap-3">
        <div>
          <label htmlFor="drill-label" className="mb-1 block text-xs text-muted">
            ドリルの名前
          </label>
          <input id="drill-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={DRILL_LIMITS.label} placeholder="ライン目印のステップ・アンド・スロー" disabled={busy} className="w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm focus:border-ice/50 focus:outline-none" />
        </div>
        <div>
          <label htmlFor="drill-start" className="mb-1 block text-xs text-muted">
            開始位置
          </label>
          <input id="drill-start" value={start} onChange={(e) => onStart(e.target.value)} disabled={busy} className="w-full rounded-lg border border-line bg-ink px-3 py-2 font-mono text-sm focus:border-ice/50 focus:outline-none" />
        </div>
      </div>
      <fieldset>
        <legend className="mb-1 text-xs text-muted">直す指標（お手本の範囲のどちら側に外れたときのドリルか）</legend>
        <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
          {METRICS.map((m) => (
            <div key={m.key} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate">{m.short}</span>
              <select
                value={sides[m.key] ?? ""}
                onChange={(e) => setSides((s) => ({ ...s, [m.key]: (e.target.value || undefined) as DrillSide | undefined }))}
                aria-label={`${m.label} のドリルか`}
                disabled={busy}
                className="rounded-md border border-line bg-panel px-2 py-1 text-xs"
              >
                <option value="">—</option>
                {SIDES.map((s) => (
                  <option key={s} value={s}>
                    {DRILL_SIDE_SHORT[s]}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </fieldset>
      {problem && (label || targets.length > 0) && <p className="text-xs text-caution">{problem}</p>}
      <Button variant="primary" className="w-full py-2.5" disabled={problem !== undefined || busy} onClick={run}>
        {busy ? <IconLoader2 size={16} className="animate-spin" aria-hidden /> : <IconVideoPlus size={16} aria-hidden />}
        ドリル動画として登録
      </Button>
      {error && <p className="text-xs text-flag">{error}</p>}
    </div>
  );
}

/** 登録したドリル動画の一覧（お手本ライブラリ） */
export function DrillList() {
  const { drills, removeDrill } = useLocalData();
  const [error, setError] = useState<string>();
  const remove = async (id: string, label: string) => {
    if (!window.confirm(`ドリル動画「${label}」の登録を消します。よろしいですか？`)) return;
    try {
      await removeDrill(id);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Card className="space-y-3 p-5">
      <SectionTitle right={<span className="text-[11px] text-faint">「YouTube で探す」の候補から登録します</span>}>ドリル動画 {drills.length} 本</SectionTitle>
      {drills.length === 0 ? (
        <p className="text-sm text-muted">まだありません。練習ドリルを解説している動画を登録すると、改善点に添えます。</p>
      ) : (
        <ul className="divide-y divide-line/60">
          {drills.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate">{d.label}</div>
                <div className="truncate text-xs text-muted">
                  {d.channel} · {formatTime(d.startSec)} から · {d.title}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {d.targets.map((t) => (
                    <Badge key={t.metric} tone="ice">
                      {METRIC_BY_KEY[t.metric].short}（{DRILL_SIDE_SHORT[t.side]}）
                    </Badge>
                  ))}
                </div>
              </div>
              <a href={drillUrl(d)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-ice hover:underline">
                YouTube で開く <IconExternalLink size={13} aria-hidden />
              </a>
              <Button variant="ghost" className="text-xs" onClick={() => void remove(d.id, d.label)}>
                <IconTrash size={14} aria-hidden /> 消す
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-flag">{error}</p>}
    </Card>
  );
}
