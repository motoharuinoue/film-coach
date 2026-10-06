// すべての画面を開き、エラー（console.error・例外・失敗したリクエスト）が 1 つもないことを確かめる（公開デモ）。
// 画面の一覧は App.tsx の経路から読むので、画面を足したのにここへ書き忘れると失敗する。

import { focus } from "./support/demo";
import { expect, open, test } from "./support/fixtures";
import { ROUTES } from "./support/routes";

const sid = focus.session.id;
/** 経路ごとの、開く URL と見出し（デモ） */
const PAGES: Record<string, { url: string; heading: string | RegExp }> = {
  "/": { url: "/", heading: /^おかえり/ },
  "/sessions/new": { url: "/sessions/new", heading: "① 取り込む" },
  "/sessions/:id/reps": { url: `/sessions/${sid}/reps`, heading: "① 取り込む：レップを選ぶ" },
  "/sessions/:id/studio": { url: `/sessions/${sid}/studio`, heading: "分析スタジオ" },
  "/sessions/:id/compare": { url: `/sessions/${sid}/compare`, heading: "分析スタジオ" },
  "/sessions/:id/report": { url: `/sessions/${sid}/report`, heading: /ここを直せば動きがつながる$/ },
  "/references": { url: "/references", heading: "お手本ライブラリ" },
  "/references/search": { url: "/references/search", heading: "お手本を探す" },
  "/progress": { url: "/progress", heading: "④ 続ける：推移" },
  "/evaluation": { url: "/evaluation", heading: "精度の評価" },
  "/footage": { url: "/footage", heading: "自分の映像" },
  "/footage/:id/pick": { url: "/footage/000000000001/pick", heading: "① 取り込む：本人を選ぶ" },
  "/footage/practices/:id": { url: "/footage/practices/000000000004", heading: "練習：練習" },
  "/footage/:id": { url: "/footage/000000000001", heading: "② 見る：自分の映像" },
  "*": { url: "/no-such-page", heading: "ページが見つかりません" },
};

test("App.tsx のすべての経路を、このテストで開く", () => {
  expect(ROUTES.length).toBeGreaterThan(10);
  expect(Object.keys(PAGES).sort()).toEqual([...ROUTES].sort());
});

for (const route of ROUTES) {
  test(`${route === "*" ? "ない経路（*）" : route} を開くと、見出しが出てエラーが起きない`, async ({ page }) => {
    const p = PAGES[route]!;
    await open(page, p.url);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(p.heading);
    await expect(page).toHaveTitle("Film Coach");
    // 遅れて起きるエラー（重み付けの検証の計算、動きの終わり など）も拾う
    await page.waitForTimeout(500);
  });
}

test("見つからないページから、ホームへ戻れる", async ({ page }) => {
  await open(page, "/no-such-page");
  await page.getByRole("link", { name: "ホームへ" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^おかえり/);
});

test("サブパス（GitHub Pages）で配信しても、読み込みとアイコンが失敗しない", async ({ page, baseURL }) => {
  const responses: { url: string; status: number }[] = [];
  page.on("response", (r) => responses.push({ url: r.url(), status: r.status() }));
  await open(page, "/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^おかえり/);
  const icon = await page.locator('link[rel="icon"]').getAttribute("href");
  expect(new URL(icon!, baseURL).pathname).toBe(new URL("favicon.svg", baseURL).pathname);
  const res = await page.request.get(new URL(icon!, baseURL).href);
  expect(res.status()).toBe(200);
  expect(responses.filter((r) => r.status >= 400)).toEqual([]);
});
