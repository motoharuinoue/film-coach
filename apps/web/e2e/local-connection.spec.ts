// 手元の解析サービスとのつながり（解析サービスは偽の応答で置き換える）：
// 止まっているときの案内と自動・手動のつなぎ直し、手元の練習とデモの切り替え、お手本が足りないときのスコア。

import { MIN_JUDGED_FOR_SCORE } from "../src/application/judgeThrows";
import { formatDate } from "../src/presentation/state/session";
import { IDS, samples } from "./support/analyzer";
import { ANALYZER_URL } from "./support/env";
import { player } from "./support/demo";
import { expect, open, test } from "./support/local";

const DEMO_GREETING = `おかえり、${player.name!.split(" ")[1]}`;

test.describe("解析サービスが止まっているとき", () => {
  test.beforeEach(({ analyzer, problems }) => {
    analyzer.online = false;
    // 止めた解析サービスへの、つながるかの確認だけは失敗してよい
    problems.allow(new RegExp(`${ANALYZER_URL.replace(/[.]/g, "\\.")}/api/health`));
  });

  test("起動のしかたを案内し、「もう一度確かめる」でつながると一覧を出す", async ({ page, analyzer }) => {
    await open(page, "/footage");
    await expect(page.getByRole("heading", { name: "解析サービスにつながりません" })).toBeVisible();
    await expect(page.getByText("uv run film-coach serve")).toBeVisible();
    await expect(page.getByLabel("解析サービスにつながっていません")).toBeVisible();
    // 手元の練習を読めないので、表示するデータはデモ
    await expect(page.getByRole("complementary").first().getByText("デモデータ（架空）")).toBeVisible();
    expect(analyzer.calls.every((c) => c.path === "/api/health")).toBe(true);

    analyzer.online = true;
    await page.getByRole("button", { name: "もう一度確かめる" }).click();
    await expect(page.getByLabel("解析サービスにつながっています")).toBeVisible();
    await expect(page.locator(`a[href="#/footage/${IDS.throws}"]`)).toContainText("IMG_0002.MOV");
    // つながると手元の練習を読み、表示するデータを選べるようになる
    await expect(page.getByRole("radiogroup", { name: "表示するデータ" })).toBeVisible();
  });

  test("解析サービスを起動すると、10 秒以内に自動でつながる", async ({ page, analyzer }) => {
    await page.clock.install();
    await open(page, "/evaluation");
    await expect(page.getByRole("heading", { name: "解析サービスにつながりません" })).toBeVisible();
    analyzer.online = true;
    await page.clock.fastForward(10_000);
    await expect(page.getByLabel("解析サービスにつながっています")).toBeVisible();
    await expect(page.getByRole("row", { name: /IMG_0002/ })).toBeVisible();
  });
});

test.describe("手元の練習とデモの切り替え", () => {
  test("手元の練習があれば手元の練習を出し、デモに切り替えると覚えておく", async ({ page }) => {
    await open(page, "/");
    const source = page.getByRole("radiogroup", { name: "表示するデータ" });
    await expect(source.getByRole("radio", { name: "手元の練習" })).toBeChecked();
    // 手元のデータには名前がない
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("おかえりなさい");
    const practice = samples.practices[0]!;
    await expect(page.locator('[data-tour="home-score"]')).toContainText(`${formatDate(practice.date as string)} · ${practice.name as string}`);
    // 取り込みは「自分の映像」から
    await expect(page.getByRole("link", { name: "映像を取り込む" })).toHaveAttribute("href", "#/footage");

    await source.getByRole("radio", { name: "デモ" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(DEMO_GREETING);
    expect(await page.evaluate(() => localStorage.getItem("film-coach:data-source"))).toBe('"demo"');
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(DEMO_GREETING);
    await expect(page.getByRole("radiogroup", { name: "表示するデータ" }).getByRole("radio", { name: "デモ" })).toBeChecked();

    await page.getByRole("radiogroup", { name: "表示するデータ" }).getByRole("radio", { name: "手元の練習" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("おかえりなさい");
  });
});

test.describe("手元の練習のスコア", () => {
  test("お手本が足りず判定できる指標がないと、スコアを 0 点ではなく「—」とし、その理由を出す", async ({ page }) => {
    // 手元のお手本は 1 本だけで、お手本ゾーン（2 本以上で作る）がない
    await open(page, "/");
    const score = page.locator('[data-tour="home-score"]');
    await expect(score).toContainText("—/ 100");
    await expect(score).toContainText(`判定できた指標が ${MIN_JUDGED_FOR_SCORE} 個に満たないため、スコアを出していません`);
    await expect(page.getByRole("link", { name: /投球ドリル/ })).toContainText("—");

    await open(page, `/sessions/${IDS.practice}/reps`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("① 取り込む：レップを選ぶ");
    await expect(page.locator(`a[href^="#/sessions/${IDS.practice}/studio?rep="]`)).toContainText("—");
    await expect(page.getByText("ベスト", { exact: true })).toHaveCount(0);

    // レポートも「大きな崩れはありません」とは言わず、判定できていないことを出す
    await open(page, `/sessions/${IDS.practice}/report`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("お手本ゾーンがまだなく、判定できていません");
    await expect(page.getByRole("heading", { name: "改善点", exact: true })).toBeVisible();
    await expect(page.getByText("判定に使うお手本ゾーンがないため、改善点を出せません。")).toBeVisible();
    await expect(page.getByText("メカニクス スコア")).toBeVisible();
    await expect(page.getByText(`判定できた指標が ${MIN_JUDGED_FOR_SCORE} 個に満たないため、スコアを出していません`)).toBeVisible();

    await open(page, "/progress");
    await expect(page.getByRole("img", { name: "セッションごとの推移" })).toContainText("スコアなし");
  });

  test("お手本が 2 本あれば、ホーム・レポートと「見る」画面で、同じ規則のスコアを出す", async ({ page, analyzer }) => {
    analyzer.addReference();
    // 「見る」画面の「お手本との一致」
    await open(page, `/footage/${IDS.throws}`);
    const line = page.getByText("お手本との一致", { exact: true }).locator("xpath=following-sibling::div[1]");
    await expect(line).toHaveText(/^\d+$/);
    const score = await line.innerText();

    await open(page, "/");
    await expect(page.locator('[data-tour="home-score"]')).toContainText(new RegExp(`(^|[^\\d])${score}\\s*/ 100`));
    await expect(page.locator('[data-tour="home-score"]')).not.toContainText("スコアを出していません");

    await open(page, `/sessions/${IDS.practice}/report`);
    await expect(page.getByText("お手本ゾーンを満点とした、判定できた指標の平均")).toBeVisible();
    await expect(page.locator("article section").first()).toContainText(new RegExp(`(^|[^\\d])${score}メカニクス スコア`));
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("お手本ゾーンがまだなく、判定できていません");
  });
});
