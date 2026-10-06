// 手元の解析サービスにつなぐ設定で、すべての画面を開き、手元の練習・お手本で表示してもエラーが起きないことを確かめる
// （解析サービスは偽の応答で置き換える。ホーム・スタジオ・レポート・推移も、手元の練習のデータで表示する）。

import { IDS } from "./support/analyzer";
import { expect, open, test } from "./support/local";
import { ROUTES } from "./support/routes";

const pid = IDS.practice;
/** 経路ごとの、開く URL と見出し、読み終えたことを示す文字（手元の練習のセッション ID は練習の ID） */
const PAGES: Record<string, { url: string; heading: string | RegExp; ready: string }> = {
  "/": { url: "/", heading: "おかえりなさい", ready: "最近のセッション" },
  "/sessions/new": { url: "/sessions/new", heading: "① 取り込む", ready: "取り込んで本人を選ぶ" },
  "/sessions/:id/reps": { url: `/sessions/${pid}/reps`, heading: "① 取り込む：レップを選ぶ", ready: "練習の画面で見る" },
  "/sessions/:id/studio": { url: `/sessions/${pid}/studio`, heading: "分析スタジオ", ready: "キネマティックシーケンス（°/s）" },
  "/sessions/:id/compare": { url: `/sessions/${pid}/compare`, heading: "分析スタジオ", ready: "指標の差" },
  "/sessions/:id/report": { url: `/sessions/${pid}/report`, heading: "お手本ゾーンがまだなく、判定できていません", ready: "参照したお手本（重みの大きい順）" },
  "/references": { url: "/references", heading: "お手本ライブラリ", ready: "重み付けの検証" },
  "/references/search": { url: "/references/search", heading: "お手本を探す", ready: "今日の無料枠" },
  "/progress": { url: "/progress", heading: "④ 続ける：推移", ready: "指標ごとの自己ベスト" },
  "/evaluation": { url: "/evaluation", heading: "精度の評価", ready: "正解を付ける映像" },
  "/footage": { url: "/footage", heading: "自分の映像", ready: "IMG_0002.MOV" },
  "/footage/:id/pick": { url: `/footage/${IDS.upload}/pick`, heading: "① 取り込む：本人を選ぶ", ready: "追いかける人" },
  "/footage/practices/:id": { url: `/footage/practices/${pid}`, heading: "練習：投球ドリル", ready: "投球ごとの指標" },
  "/footage/:id": { url: `/footage/${IDS.throws}`, heading: "② 見る：自分の映像", ready: "追跡の結果" },
  "*": { url: "/no-such-page", heading: "ページが見つかりません", ready: "ホームへ" },
};

test("App.tsx のすべての経路を、このテストで開く", () => {
  expect(Object.keys(PAGES).sort()).toEqual([...ROUTES].sort());
});

for (const route of ROUTES) {
  test(`${route === "*" ? "ない経路（*）" : route} を手元のデータで開くと、読み終えてエラーが起きない`, async ({ page }) => {
    const p = PAGES[route]!;
    await open(page, p.url);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(p.heading);
    await expect(page.getByText(p.ready, { exact: true }).first()).toBeVisible();
    await page.waitForTimeout(500);
  });
}

test("画面を開いたとき、手元のデータは 1 回だけ読み、画面を移るたびに読み直す", async ({ page, analyzer }) => {
  await open(page, "/");
  await expect(page.getByRole("radiogroup", { name: "表示するデータ" })).toBeVisible();
  await page.waitForTimeout(500);
  for (const path of ["/api/references", "/api/practices", "/api/drills"]) expect(analyzer.find("GET", path), path).toHaveLength(1);

  // ほかの画面で解析・登録した結果を映すため、画面を移ったら読み直す
  await page.getByRole("link", { name: "推移を見る" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("④ 続ける：推移");
  await expect.poll(() => analyzer.find("GET", "/api/references").length).toBe(2);
  await page.waitForTimeout(500);
  for (const path of ["/api/references", "/api/practices", "/api/drills"]) expect(analyzer.find("GET", path), path).toHaveLength(2);
});
