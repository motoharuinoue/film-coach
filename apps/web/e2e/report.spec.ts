// レポート：改善点トップ 3 とドリル動画、PDF への出力、リンクのコピー、参照したお手本（公開デモ）。

import { METRIC_BY_KEY, formatMetric } from "../src/domain/metrics";
import { bench, coach, focus } from "./support/demo";
import { expect, open, test } from "./support/fixtures";

const { session, rep } = focus;
const REPORT = `/sessions/${session.id}/report`;
const findings = coach.findings(rep, session.camera, bench);

test.describe("レポート", () => {
  test("改善点トップ 3 に、今回の値・目標・根拠の時刻・ドリル動画を付ける", async ({ page }) => {
    await open(page, REPORT);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${findings[0]!.title}。ここを直せば動きがつながる`);
    await expect(page.getByRole("heading", { name: `改善点トップ ${findings.length}` })).toBeVisible();
    expect(findings).toHaveLength(3);

    const section = page.locator('[data-tour="report-findings"]');
    const items = section.getByRole("heading", { level: 3 });
    await expect(items).toHaveText(findings.map((f) => f.title));
    for (const f of findings) {
      const card = section.locator("div.grid", { has: page.getByRole("heading", { name: f.title }) });
      await expect(card).toContainText(METRIC_BY_KEY[f.key].label);
      await expect(card).toContainText(f.body);
      await expect(card).toContainText(`今回 ${formatMetric(f.key, rep.metrics[f.key])}`);
      await expect(card).toContainText(`目標 ${f.target}`);
      await expect(card).toContainText(`根拠 ${(f.frame / rep.seq.fps).toFixed(2)}s`);
      // デモのドリル動画は架空なので、YouTube へのリンクにはしない
      await expect(card).toContainText(`${f.drill!.label}${f.drill!.channel} · ${f.drill!.at} から`);
      await expect(card.getByRole("link")).toHaveCount(0);
    }
    await expect(page.getByText(`ばらつき ${coach.consistency(session).spread.toFixed(1)} cm`)).toBeVisible();
  });

  test("参照したお手本を、重みの大きい順に並べる", async ({ page }) => {
    await open(page, REPORT);
    const rows = page.getByRole("table").getByRole("row");
    const expected = coach
      .references()
      .map((r) => ({ r, w: bench.weights.overall[r.id] ?? 0 }))
      .sort((a, b) => b.w - a.w);
    await expect(rows).toHaveCount(expected.length);
    for (const [i, { r, w }] of expected.entries()) {
      await expect(rows.nth(i)).toContainText(r.channel);
      await expect(rows.nth(i).getByRole("cell").last()).toHaveText(w.toFixed(2));
    }
  });

  test("「PDF に出力」で印刷の画面を開き、「リンクをコピー」でこのレポートの URL をコピーする", async ({ page }) => {
    // 印刷の画面とクリップボードは、ブラウザの外（OS）のものなので、呼ばれたことと渡した値だけを確かめる
    await page.addInitScript(() => {
      const w = window as unknown as { printed: number; copied: string[] };
      w.printed = 0;
      w.copied = [];
      window.print = () => void w.printed++;
      Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => void w.copied.push(text) } });
    });
    await open(page, REPORT);
    await page.getByRole("button", { name: "PDF に出力" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);

    await page.getByRole("button", { name: "リンクをコピー" }).click();
    await expect(page.getByRole("button", { name: "コピーしました" })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { copied: string[] }).copied)).toEqual([page.url()]);
    // しばらくすると元の表示に戻る
    await expect(page.getByRole("button", { name: "リンクをコピー" })).toBeVisible();
  });

  test("印刷用の表示では、操作のボタンとガイドを出さない", async ({ page }) => {
    await open(page, REPORT);
    await expect(page.getByRole("region", { name: "この画面でできること" })).toBeVisible();
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("button", { name: "PDF に出力" })).toBeHidden();
    await expect(page.getByRole("region", { name: "この画面でできること" })).toBeHidden();
    await expect(page.getByRole("navigation", { name: "メイン" })).toBeHidden();
    await expect(page.getByRole("heading", { name: `改善点トップ ${findings.length}` })).toBeVisible();
  });
});
