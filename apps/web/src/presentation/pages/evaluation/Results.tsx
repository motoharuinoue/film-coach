// 精度の評価の結果：関節の位置（cm）、接地・リリースの瞬間（ミリ秒）、指標（手で測った値との差）。

import { EVALUATED_METRICS, EVENT_LABEL, GROUP_LABEL, JOINT_GROUPS, type ErrorStats, type Evaluation, type EventKey } from "../../../domain/evaluation";
import { METRIC_BY_KEY, isImprecise } from "../../../domain/metrics";
import { Card, SectionTitle, cx } from "../../components/ui";

const pct = (x: number) => `${Math.round(x * 100)}%`;

function Th({ children, left }: { children: React.ReactNode; left?: boolean }) {
  return <th className={cx("px-2 py-2 font-normal", left ? "pr-3 pl-0 text-left" : "text-right")}>{children}</th>;
}

function Td({ children, strong, left }: { children: React.ReactNode; strong?: boolean; left?: boolean }) {
  return <td className={cx("px-2 py-2", left ? "pr-3 pl-0" : "text-right font-mono", strong ? "text-text" : "text-muted")}>{children}</td>;
}

const fmt = (s: ErrorStats | null, digits = 1, unit = " cm") => (s ? `${s.mean.toFixed(digits)}${unit}` : "—");

export function Results({ data, onRefresh, busy }: { data: Evaluation; onRefresh: () => void; busy: boolean }) {
  const { report, thresholdsCm } = data;
  const th = thresholdsCm.map((t) => `${t} cm 以内`);
  return (
    <Card className="space-y-6 p-5" data-tour="evaluation-results">
      <SectionTitle
        right={
          <button type="button" onClick={onRefresh} disabled={busy} className="text-xs text-turf hover:underline disabled:opacity-50">
            {busy ? "計算しています…" : "付けた正解で計算し直す"}
          </button>
        }
      >
        結果
      </SectionTitle>
      <p className="text-sm text-muted">
        正解：映像 {report.videos} 本、投球 {report.throws} 球（接地とリリースを付けたもの）、関節を付けたフレーム {report.frames} 枚
      </p>
      {!report.joints.final ? (
        <p className="text-sm text-muted">正解を付けると、ここに誤差が出ます。</p>
      ) : (
        <>
          <section className="overflow-x-auto">
            <h3 className="mb-2 text-xs text-muted">関節の位置（正解の点との距離）</h3>
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] text-muted">
                  <Th left>骨格</Th>
                  <Th>平均</Th>
                  <Th>中央値</Th>
                  <Th>90% 点</Th>
                  {th.map((x) => (
                    <Th key={x}>{x}</Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["モデルの出力", report.joints.raw],
                    ["指標に使う骨格（補正・平滑化のあと）", report.joints.final],
                  ] as const
                ).map(([name, s]) => (
                  <tr key={name} className="border-b border-line/60">
                    <Td left strong>
                      {name}
                    </Td>
                    <Td strong>{fmt(s)}</Td>
                    <Td>{fmt(s && { ...s, mean: s.median })}</Td>
                    <Td>{fmt(s && { ...s, mean: s.p90 })}</Td>
                    {thresholdsCm.map((_, i) => (
                      <Td key={i}>{s ? pct(s.within[i] ?? 0) : "—"}</Td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="mt-4 w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] text-muted">
                  <Th left>部位</Th>
                  <Th>モデルの出力（平均）</Th>
                  <Th>指標に使う骨格（平均）</Th>
                  {th.map((x) => (
                    <Th key={x}>{x}</Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {JOINT_GROUPS.map((g) => {
                  const { raw, final } = report.groups[g];
                  return (
                    <tr key={g} className="border-b border-line/60">
                      <Td left strong>
                        {GROUP_LABEL[g]}
                      </Td>
                      <Td>{fmt(raw)}</Td>
                      <Td strong>{fmt(final)}</Td>
                      {thresholdsCm.map((_, i) => (
                        <Td key={i}>{final ? pct(final.within[i] ?? 0) : "—"}</Td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section className="overflow-x-auto">
            <h3 className="mb-2 text-xs text-muted">瞬間（正解のフレームとの差。正なら解析が遅い）</h3>
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] text-muted">
                  <Th left>瞬間</Th>
                  <Th>平均（絶対値）</Th>
                  <Th>投球ごとの差</Th>
                </tr>
              </thead>
              <tbody>
                {(["plant", "release"] as EventKey[]).map((k) => (
                  <tr key={k} className="border-b border-line/60">
                    <Td left strong>
                      {EVENT_LABEL[k]}
                    </Td>
                    <Td strong>{fmt(report.events[k], 0, " ms")}</Td>
                    <Td>
                      {report.details.events
                        .filter((e) => e.event === k)
                        .map((e) => `${e.frames > 0 ? "+" : ""}${e.frames} コマ`)
                        .join("、") || "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="overflow-x-auto">
            <h3 className="mb-2 text-xs text-muted">指標（正解の骨格を、正解の瞬間で測った値との差）</h3>
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] text-muted">
                  <Th left>指標</Th>
                  <Th>解析の値との差（平均）</Th>
                  <Th>うち骨格の誤差による分</Th>
                  <Th>判定に使わない値</Th>
                </tr>
              </thead>
              <tbody>
                {EVALUATED_METRICS.map((m) => {
                  const d = METRIC_BY_KEY[m];
                  const r = report.metrics[m];
                  const rows = report.details.metrics.filter((e) => e.metric === m);
                  const imprecise = rows.filter((e) => isImprecise(m, e.uncertainty ?? undefined)).length;
                  return (
                    <tr key={m} className="border-b border-line/60">
                      <Td left strong>
                        {d.label}
                      </Td>
                      <Td strong>{fmt(r?.total ?? null, d.digits + 1, d.unit)}</Td>
                      <Td>{fmt(r?.pose ?? null, d.digits + 1, d.unit)}</Td>
                      <Td>{rows.length ? `${imprecise} / ${rows.length}` : "—"}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] leading-relaxed text-faint">
              「判定に使わない値」は、瞬間が半コマずれたときの変わり幅が上限を超え、画面で判定していない値の数です。差のうち「骨格の誤差による分」を除いた残りは、瞬間のずれによるものです。
            </p>
          </section>
        </>
      )}
    </Card>
  );
}
