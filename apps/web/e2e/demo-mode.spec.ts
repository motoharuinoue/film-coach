// 公開デモ（解析サービスなし）：合成データだけで動き、解析サービスが要る画面では手元での起動のしかたを案内する。

import { DEMO_URL } from "./support/env";
import { player } from "./support/demo";
import { expect, open, test } from "./support/fixtures";

/** 解析サービスが要る画面（AnalyzerGate） */
const GATED = [
  { path: "/footage", heading: "自分の映像" },
  { path: "/evaluation", heading: "精度の評価" },
  { path: "/references/search", heading: "お手本を探す" },
  { path: "/footage/000000000001/pick", heading: "① 取り込む：本人を選ぶ" },
  { path: "/footage/000000000001", heading: "② 見る：自分の映像" },
  { path: "/footage/practices/000000000004", heading: "練習：練習" },
];

test.describe("公開デモ（解析サービスなし）", () => {
  test("解析サービスにはつながず、合成データ（デモデータ）を出す", async ({ page }) => {
    const origins = new Set<string>();
    page.on("request", (r) => origins.add(new URL(r.url()).origin));
    await open(page, "/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`おかえり、${player.name!.split(" ")[1]}`);
    const sidebar = page.getByRole("complementary").first();
    await expect(sidebar.getByText("デモデータ（架空）")).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "表示するデータ" })).toHaveCount(0);
    // 解析サービスのつながり具合の印は出さない
    await expect(page.getByLabel(/解析サービスにつな/)).toHaveCount(0);

    for (const g of GATED) {
      await open(page, g.path);
      await expect(page.getByRole("heading", { name: "自分の映像は、手元の解析サービスで扱います" })).toBeVisible();
    }
    await open(page, "/references");
    await expect(page.getByRole("heading", { name: "お手本ライブラリ" })).toBeVisible();
    expect([...origins]).toEqual([new URL(DEMO_URL).origin]);
  });

  test("表示するデータに「手元の練習」を選んだ記録があっても、手元の練習がなければデモのデータを出す", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("film-coach:data-source", JSON.stringify("local")));
    await open(page, "/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`おかえり、${player.name!.split(" ")[1]}`);
    await expect(page.getByRole("complementary").first().getByText("デモデータ（架空）")).toBeVisible();
    // 取り込みは、デモのシミュレーションの画面へ
    await page.getByRole("link", { name: "新規セッション" }).click();
    await expect(page.getByRole("heading", { name: "① 取り込む" })).toBeVisible();
    await expect(page.getByRole("button", { name: "解析を始める" })).toBeVisible();
  });

  for (const g of GATED) {
    test(`${g.heading}（${g.path}）では、解析サービスを手元で動かす方法を案内する`, async ({ page }) => {
      await open(page, g.path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(g.heading);
      await expect(page.getByRole("heading", { name: "自分の映像は、手元の解析サービスで扱います" })).toBeVisible();
      await expect(page.getByText("uv run film-coach serve")).toBeVisible();
      // 手元で止まっているときの案内（もう一度確かめる）は出さない
      await expect(page.getByRole("button", { name: "もう一度確かめる" })).toHaveCount(0);
    });
  }

  test("お手本ライブラリでは、手元のお手本や YouTube の検索を出さず、架空のデータだと断る", async ({ page }) => {
    await open(page, "/references");
    await expect(page.getByText("チャンネル・動画はすべて架空のデモデータです。")).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "お手本の出どころ" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "YouTube で探す" })).toHaveCount(0);
  });
});
