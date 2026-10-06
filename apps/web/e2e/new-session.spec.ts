// ① 取り込む（公開デモ）：動画を選ぶか YouTube の区間を指定し、模擬の解析を経てレップの一覧へ進む。

import { CAMERA_LABEL } from "../src/domain/camera";
import { isValidFor, METRICS } from "../src/domain/metrics";
import { focus } from "./support/demo";
import { expect, open, test } from "./support/fixtures";

test.describe("① 取り込む（デモ）", () => {
  test("動画ファイルを選ぶと、模擬の解析を経てレップの一覧へ進む", async ({ page }) => {
    await open(page, "/sessions/new");
    await expect(page.getByRole("heading", { name: "① 取り込む" })).toBeVisible();
    await expect(page.getByText("デモでは解析をシミュレーションし")).toBeVisible();
    const start = page.getByRole("button", { name: "解析を始める" });
    await expect(start).toBeDisabled();

    // 動画でないファイルは受け付けない
    const input = page.locator('input[type="file"]');
    await input.setInputFiles({ name: "memo.txt", mimeType: "text/plain", buffer: Buffer.from("memo") });
    await expect(page.getByText("動画ファイル（mp4 / mov）を選んでください")).toBeVisible();
    await expect(start).toBeDisabled();

    // ブラウザで読めない動画でも、名前と大きさは出して先へ進める（解析サービスでは読める）
    await input.setInputFiles({ name: "IMG_0001.MOV", mimeType: "video/quicktime", buffer: Buffer.alloc(2 * 1024 * 1024) });
    await expect(page.getByText("IMG_0001.MOV")).toBeVisible();
    await expect(page.getByText("2.0 MB")).toBeVisible();
    await expect(page.getByText("このブラウザでは動画の情報を読めませんでした。")).toBeVisible();
    await expect(start).toBeEnabled();

    await start.click();
    await expect(page.getByRole("heading", { name: "解析パイプライン" })).toBeVisible();
    // 8 段階を順に進める（1 段階 0.5〜0.9 秒）
    await expect(page.getByText(`解析が終わりました。${focus.session.reps.length} レップを検出しました。`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("8 / 8")).toBeVisible();
    await page.getByRole("link", { name: "レップを選ぶ", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#/sessions/${focus.session.id}/reps$`));
    await expect(page.locator(`a[href^="#/sessions/${focus.session.id}/studio?rep="]`)).toHaveCount(focus.session.reps.length);
  });

  test("YouTube の URL と 60 秒以内の区間を確かめ、埋め込みで見せる", async ({ page }) => {
    // 埋め込みプレイヤーは外のページなので、空のページを返す
    const embeds: string[] = [];
    await page.route("https://www.youtube-nocookie.com/**", (route) => {
      embeds.push(route.request().url());
      return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>embed</title>" });
    });
    await open(page, "/sessions/new");
    await page.getByRole("radio", { name: "YouTube URL" }).click();
    const url = page.getByRole("textbox", { name: "動画の URL" });
    await url.fill("https://example.com/watch?v=abc");
    await page.getByRole("button", { name: "読み込む" }).click();
    await expect(page.getByText("YouTube の動画 URL を入力してください")).toBeVisible();

    await url.fill("https://www.youtube.com/watch?v=Qb7Throw_01");
    await url.press("Enter");
    await expect(page.getByTitle("YouTube の埋め込みプレイヤー")).toBeVisible();
    await expect.poll(() => embeds.at(-1)).toContain("/embed/Qb7Throw_01?rel=0&start=0&end=8");

    await page.getByRole("textbox", { name: "終了" }).fill("1:30");
    await expect(page.getByText(/60 秒/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "解析を始める" })).toBeDisabled();
    await page.getByRole("textbox", { name: "終了" }).fill("0:45");
    await expect(page.getByText("区間 0:00〜0:45（45 秒）")).toBeVisible();
    await expect(page.getByRole("button", { name: "解析を始める" })).toBeEnabled();
  });

  test("撮影の角度を選ぶと、その角度で測れる指標を出す", async ({ page }) => {
    await open(page, "/sessions/new");
    for (const camera of ["behind", "side"] as const) {
      await page.getByRole("radiogroup", { name: "カメラ角度" }).getByRole("radio", { name: CAMERA_LABEL[camera] }).click();
      const valid = METRICS.filter((m) => isValidFor(m, camera)).length;
      await expect(page.getByRole("heading", { name: `${CAMERA_LABEL[camera]}の映像で測れる指標` })).toBeVisible();
      await expect(page.getByText(`${valid} / ${METRICS.length}`, { exact: true })).toBeVisible();
    }
  });
});
