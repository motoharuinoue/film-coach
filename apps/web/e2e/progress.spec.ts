// 推移：セッションごとのスコアと指標の推移、指標ごとの自己ベスト（公開デモ）。

import { isValidFor, METRICS } from "../src/domain/metrics";
import { formatDate } from "../src/presentation/state/session";
import { bench, coach } from "./support/demo";
import { expect, open, test } from "./support/fixtures";

const sessions = coach.sessions();

test.describe("推移", () => {
  test("スコアの推移を、セッションの日付ごとに出す", async ({ page }) => {
    await open(page, "/progress");
    await expect(page.getByRole("heading", { name: "④ 続ける：推移" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "メカニクス スコア" })).toBeVisible();
    const chart = page.getByRole("img", { name: "セッションごとの推移" });
    for (const s of sessions) await expect(chart).toContainText(formatDate(s.date));
    // スコアを出せないセッション（試合映像など）は、その旨を出す
    if (sessions.some((s) => coach.sessionScore(s, bench) === undefined)) await expect(chart).toContainText("スコアなし");
  });

  test("見る指標を切り替えると、その指標の推移とお手本ゾーンを出す", async ({ page }) => {
    await open(page, "/progress");
    const measured = METRICS.filter((m) => sessions.some((s) => isValidFor(m, s.camera) && s.reps.some((r) => r.metrics[m.key] !== undefined)));
    const buttons = page.locator(".card").first().getByRole("button");
    await expect(buttons).toHaveCount(measured.length + 1);

    const def = measured.find((m) => m.key === "strideRatio")!;
    await page.getByRole("button", { name: def.short, exact: true }).click();
    await expect(page.getByRole("heading", { name: def.label })).toBeVisible();
    await expect(page.getByText(def.hint)).toBeVisible();
    await expect(page.getByRole("img", { name: "セッションごとの推移" })).toContainText("お手本ゾーン");
    // 横から撮っていない試合映像では測れない
    const game = sessions.find((s) => !isValidFor(def, s.camera));
    if (game) await expect(page.getByRole("img", { name: "セッションごとの推移" })).toContainText("では測れない");

    await page.getByRole("button", { name: "スコア", exact: true }).click();
    await expect(page.getByRole("heading", { name: "メカニクス スコア" })).toBeVisible();
  });

  test("指標ごとの自己ベストを、日付と一緒に出す", async ({ page }) => {
    await open(page, "/progress");
    const card = page.locator(".card", { has: page.getByRole("heading", { name: "指標ごとの自己ベスト" }) });
    const records = METRICS.filter((m) => sessions.some((s) => s.reps.some((r) => coach.zonesOf(r, bench)[m.key])));
    for (const m of records) await expect(card).toContainText(m.label);
    await expect(card.getByText(/^\d+\/\d+$/)).not.toHaveCount(0);
  });
});
