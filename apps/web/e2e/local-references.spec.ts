// 手元のお手本とドリル動画（手元の解析サービスにつなぐ設定。解析サービスは偽の応答で置き換える）：
// 手元のお手本の手動調整、YouTube の検索と、候補の取り込み・ドリル動画としての登録。

import type { Page } from "@playwright/test";
import { DRILL_SIDE_SHORT } from "../src/domain/drill";
import { METRIC_BY_KEY } from "../src/domain/metrics";
import { IDS, samples } from "./support/analyzer";
import { ANALYZER_URL } from "./support/env";
import { expect, open, test } from "./support/local";

const candidates = samples.youtubeSearch.candidates as { videoId: string; title: string; channel: string; durationSec: number; url: string }[];

/** 候補を開くと埋め込みプレイヤーを出すので、空のページを返す */
const stubEmbed = (page: Page) => page.route("https://www.youtube-nocookie.com/**", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>embed</title>" }));

test.describe("手元のお手本とドリル動画", () => {
  test("手元のお手本を先に出し、手動調整を解析サービスに保存する。デモのお手本にも切り替えられる", async ({ page, analyzer }) => {
    await open(page, "/references");
    const origin = page.getByRole("radiogroup", { name: "お手本の出どころ" });
    await expect(origin.getByRole("radio", { name: `手元のお手本（${analyzer.references.size}）` })).toBeChecked();
    const ref = samples.references[0]!;
    const detail = page.locator('[data-tour="references-detail"]');
    await expect(detail.getByRole("heading", { level: 2 }).first()).toHaveText(ref.title as string);
    await expect(detail).toContainText(`お手本の選手の身長を ${ref.playerHeightCm as number} cm として解析しています`);

    const patched = page.waitForRequest((r) => r.method() === "PATCH" && r.url() === `${ANALYZER_URL}/api/references/${IDS.reference}`);
    await detail.getByRole("button", { name: "除外" }).click();
    expect((await patched).postDataJSON()).toEqual({ manual: { ...(ref.manual as object), excluded: true } });
    await expect(page.getByRole("button", { name: "手動調整を元に戻す" })).toBeVisible();
    await expect.poll(() => analyzer.references.get(IDS.reference)!.manual.excluded).toBe(true);

    // ドリル動画（手元だけ）
    const drill = samples.drills[0]!;
    const drills = page.locator(".card", { has: page.getByRole("heading", { name: `ドリル動画 ${samples.drills.length} 本` }) });
    await expect(drills).toContainText(drill.label as string);
    await expect(drills.getByRole("link", { name: "YouTube で開く" })).toHaveAttribute("href", new RegExp(`${drill.youtubeId as string}.*t=${drill.startSec as number}`));

    await origin.getByRole("radio", { name: "デモ" }).click();
    await expect(page.getByText("チャンネル・動画はすべて架空のデモデータです。")).toBeVisible();
    await expect(drills).toHaveCount(0);
  });

  test("YouTube で探すと候補に人気度（P）とチャンネル（C）の見込みを付けて並べ、60 秒以内の区間を取り込める", async ({ page, analyzer }) => {
    await stubEmbed(page);
    await open(page, "/references");
    await page.getByRole("link", { name: "YouTube で探す" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("お手本を探す");
    await expect(page.getByText("今日の無料枠", { exact: true })).toBeVisible();

    await page.getByRole("textbox", { name: "検索語" }).fill("QB drop back");
    await page.getByRole("button", { name: "探す", exact: true }).click();
    await expect(page.getByRole("heading", { name: /「QB drop back」の候補 \d+ 件/ })).toBeVisible();
    const search = analyzer.find("GET", "/api/youtube/search")[0]!;
    expect(Object.fromEntries(search.query)).toEqual({ q: "QB drop back", cc: "false", max: "12" });
    for (const c of candidates) await expect(page.getByRole("button", { name: new RegExp(c.title) })).toContainText("P 人気度");

    const c = candidates[0]!;
    await page.getByRole("button", { name: new RegExp(c.title) }).click();
    await expect(page.getByTitle(`${c.title} の埋め込みプレイヤー`)).toBeVisible();
    // 投げている区間を 60 秒以内・動画の長さの中で指定して取り込むと、お手本の選手を選ぶ画面へ
    const run = page.getByRole("button", { name: "取り込んで、お手本の選手を選ぶ" });
    await page.getByRole("textbox", { name: "開始" }).fill("0:10");
    await page.getByRole("textbox", { name: "終了" }).fill("1:20");
    await expect(page.getByText("区間は 60 秒以内にしてください")).toBeVisible();
    await expect(run).toBeDisabled();
    await page.getByRole("textbox", { name: "開始" }).fill("1:00");
    await page.getByRole("textbox", { name: "終了" }).fill("1:40");
    await expect(page.getByText(`動画の長さ（1:${String(c.durationSec - 60).padStart(2, "0")}）を超えています`)).toBeVisible();
    await page.getByRole("textbox", { name: "終了" }).fill("1:30");
    const imported = page.waitForRequest((r) => r.method() === "POST" && r.url() === `${ANALYZER_URL}/api/videos/youtube`);
    await run.click();
    expect((await imported).postDataJSON()).toEqual({ url: c.url, start: 60, end: 90 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("① 取り込む：本人を選ぶ");
    await expect(page.getByRole("button", { name: "この人を追う" })).toBeDisabled();
  });

  test("候補をドリル動画として登録すると、直す指標と開始位置を送り、ドリル動画の一覧に加える", async ({ page, analyzer }) => {
    await stubEmbed(page);
    await open(page, "/references/search");
    await page.getByRole("textbox", { name: "検索語" }).fill("QB drill");
    await page.getByRole("button", { name: "探す", exact: true }).click();
    const c = candidates[1]!;
    await page.getByRole("button", { name: new RegExp(c.title) }).click();
    await page.getByRole("radio", { name: "ドリル動画として登録" }).click();

    const register = page.getByRole("button", { name: "ドリル動画として登録" });
    await expect(register).toBeDisabled();
    await page.getByRole("textbox", { name: "ドリルの名前" }).fill("前足のブロック");
    await expect(page.getByText("直す指標を 1 つ以上選んでください")).toBeVisible();
    await page.getByRole("combobox", { name: `${METRIC_BY_KEY.frontKnee.label}：どちら側に外れたときのドリルか` }).selectOption({ label: DRILL_SIDE_SHORT.high });
    await page.getByRole("textbox", { name: "開始位置" }).fill("1:20");
    // 開始位置は、埋め込みプレイヤーにも反映する
    await expect(page.getByTitle(`${c.title} の埋め込みプレイヤー`)).toHaveAttribute("src", new RegExp(`/embed/${c.videoId}\\?rel=0&start=80$`));
    const sent = page.waitForRequest((r) => r.method() === "POST" && r.url() === `${ANALYZER_URL}/api/drills`);
    await register.click();
    expect((await sent).postDataJSON()).toEqual({ youtubeId: c.videoId, title: c.title, channel: c.channel, startSec: 80, label: "前足のブロック", targets: [{ metric: "frontKnee", side: "high" }] });
    await expect(page.getByText("「前足のブロック」を登録しました")).toBeVisible();

    await page.getByRole("link", { name: "お手本ライブラリでドリル動画を見る" }).click();
    const drills = page.locator(".card", { has: page.getByRole("heading", { name: `ドリル動画 ${analyzer.drills.size} 本` }) });
    await expect(drills.getByRole("listitem").first()).toContainText("前足のブロック");
    await expect(drills.getByRole("listitem").first()).toContainText(`${METRIC_BY_KEY.frontKnee.short}（${DRILL_SIDE_SHORT.high}）`);
  });
});
