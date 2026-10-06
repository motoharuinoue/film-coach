// 使い方ツアー：初めてホームを開くと始まり、主な画面を順に開いて見る場所を光らせる（公開デモ）。

import { focus } from "./support/demo";
import { expect, open, test } from "./support/fixtures";

const sid = focus.session.id;
/** ツアーの段階：開く画面と、光らせる場所 */
const STEPS = [
  { route: "/", target: "nav-steps", title: "この順に使います" },
  { route: "/", target: "home-score", title: "最新のスコア" },
  { route: "/", target: "home-next", title: "次に直すこと" },
  { route: `/sessions/${sid}/studio`, target: "studio-video", title: "② 骨格で見る" },
  { route: `/sessions/${sid}/studio`, target: "studio-timeline", title: "フェーズとコマ送り" },
  { route: `/sessions/${sid}/studio`, target: "studio-metrics", title: "指標カード" },
  { route: `/sessions/${sid}/report`, target: "report-findings", title: "③ 改善点を読む" },
  { route: "/references", target: "references-detail", title: "判定の基準を整える" },
];

test.describe("使い方ツアー", () => {
  test.describe("初めて開いたとき", () => {
    test.use({ tourSeen: false });

    test("ホームで自動で始まり、ボタンとキーで進んで戻り、最後まで見ると閉じて二度と出ない", async ({ page }) => {
      await open(page, "/");
      const tour = page.getByRole("dialog", { name: "使い方ツアー" });
      await expect(tour).toBeVisible();

      for (const [i, s] of STEPS.entries()) {
        await expect(tour).toContainText(`${i + 1} / ${STEPS.length}`);
        await expect(tour.getByRole("heading")).toHaveText(s.title);
        await expect(page).toHaveURL(new RegExp(`#${s.route}$`));
        // 光らせる場所が画面に入るよう動かしている
        await expect(page.locator(`[data-tour="${s.target}"]`)).toBeInViewport();
        if (i === 3) {
          // ツアー中の ← → はツアーが受け取り、スタジオのコマ送りは動かない
          const slider = page.getByRole("slider", { name: "再生位置" });
          const before = await slider.inputValue();
          await page.keyboard.press("ArrowRight");
          await expect(tour).toContainText(`5 / ${STEPS.length}`);
          await expect(slider).toHaveValue(before);
          await page.keyboard.press("ArrowLeft");
          await expect(tour).toContainText(`4 / ${STEPS.length}`);
          await page.keyboard.press("ArrowLeft");
          await expect(tour).toContainText(`3 / ${STEPS.length}`);
          await expect(page).toHaveURL(/#\/$/);
          await page.keyboard.press("Enter");
          await expect(tour).toContainText(`4 / ${STEPS.length}`);
          await expect(page).toHaveURL(new RegExp(`#${s.route}$`));
        }
        if (i < STEPS.length - 1) await tour.getByRole("button", { name: "次へ" }).click();
      }

      await expect(tour).toContainText("サイドバーの「使い方ツアー」から、いつでも見直せます。");
      await tour.getByRole("button", { name: "はじめる" }).click();
      await expect(tour).toBeHidden();
      expect(await page.evaluate(() => localStorage.getItem("film-coach:tour-seen"))).toBe("true");

      await open(page, "/");
      await page.reload();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^おかえり/);
      await expect(page.getByRole("dialog", { name: "使い方ツアー" })).toHaveCount(0);
    });

    test("× か Esc で途中で閉じても、見たことにする", async ({ page }) => {
      await open(page, "/");
      const tour = page.getByRole("dialog", { name: "使い方ツアー" });
      await tour.getByRole("button", { name: "次へ" }).click();
      await tour.getByRole("button", { name: "ツアーを終える" }).click();
      await expect(tour).toBeHidden();
      await page.reload();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^おかえり/);
      await expect(page.getByRole("dialog", { name: "使い方ツアー" })).toHaveCount(0);
    });
  });

  test("サイドバーの「使い方ツアー」から、ほかの画面でも始め直せる", async ({ page }) => {
    await open(page, "/progress");
    await expect(page.getByRole("dialog", { name: "使い方ツアー" })).toHaveCount(0);
    await page.getByRole("button", { name: "使い方ツアー" }).click();
    const tour = page.getByRole("dialog", { name: "使い方ツアー" });
    await expect(tour).toContainText(`1 / ${STEPS.length}`);
    await expect(page).toHaveURL(/#\/$/);
    await page.keyboard.press("Escape");
    await expect(tour).toBeHidden();
  });
});
