// 狭い画面（スマホ、幅 375px）：主な画面が横にはみ出さず、ナビとツアーが使える（公開デモ）。

import { focus } from "./support/demo";
import { expect, horizontalOverflow, open, test } from "./support/fixtures";

const sid = focus.session.id;
const PAGES = [
  { path: "/", heading: /^おかえり/ },
  { path: "/sessions/new", heading: "① 取り込む" },
  { path: `/sessions/${sid}/reps`, heading: "① 取り込む：レップを選ぶ" },
  { path: `/sessions/${sid}/studio`, heading: "分析スタジオ" },
  { path: `/sessions/${sid}/studio?view=compare`, heading: "分析スタジオ" },
  { path: `/sessions/${sid}/report`, heading: /ここを直せば動きがつながる$/ },
  { path: "/references", heading: "お手本ライブラリ" },
  { path: "/progress", heading: "④ 続ける：推移" },
  { path: "/footage", heading: "自分の映像" },
  { path: "/evaluation", heading: "精度の評価" },
];

test.describe("狭い画面（幅 375px）", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  for (const p of PAGES) {
    test(`${p.path} は横にはみ出さない`, async ({ page }) => {
      await open(page, p.path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(p.heading);
      // 遅れて出る表（重み付けの検証など）も入れて測る
      await page.waitForTimeout(800);
      expect(await horizontalOverflow(page)).toBe(0);
    });
  }

  test("ナビは横に動かして使え、ツアーも始められる", async ({ page }) => {
    await open(page, "/");
    const nav = page.getByRole("navigation", { name: "メイン" });
    // ナビの中だけが横に動く（ページ全体は動かない）
    expect(await nav.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await nav.getByRole("link", { name: "お手本ライブラリ" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("お手本ライブラリ");
    await nav.getByRole("button", { name: "ツアー" }).click();
    const tour = page.getByRole("dialog", { name: "使い方ツアー" });
    await expect(tour).toContainText("1 / 8");
    // カードは画面の中に収まる
    await expect(tour.getByRole("button", { name: "次へ" })).toBeInViewport();
    await tour.getByRole("button", { name: "次へ" }).click();
    await expect(tour).toContainText("2 / 8");
    await expect(page.locator('[data-tour="home-score"]')).toBeInViewport();
    await tour.getByRole("button", { name: "ツアーを終える" }).click();
    await expect(tour).toBeHidden();
    expect(await horizontalOverflow(page)).toBe(0);
  });
});
