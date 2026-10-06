// 練習（手元の解析サービスにつなぐ設定。解析サービスは偽の応答で置き換える）：
// まとめた映像の投球を並べ、まだ解析していない映像をまとめて解析し、投球の映像を開く。

import { formatMetric } from "../src/domain/metrics";
import { releaseFrame } from "../src/domain/throws";
import { parseThrows } from "../src/infrastructure/http/httpFootageLibrary";
import { IDS, samples } from "./support/analyzer";
import { ANALYZER_URL } from "./support/env";
import { expect, open, test } from "./support/local";

const PRACTICE = `/footage/practices/${IDS.practice}`;
const rep = parseThrows(samples.throws).reps[0]!;
const fps = samples.throws.video.fps;

test.describe("練習", () => {
  test("まとめた映像の投球を表に並べ、まだ解析していない映像を同じ身長でまとめて解析する", async ({ page, analyzer }) => {
    await open(page, PRACTICE);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("練習：投球ドリル");
    const summary = (label: string) => page.locator(".card", { has: page.getByText(label, { exact: true }) });
    await expect(summary("投球")).toContainText("1球");
    await expect(summary("映像")).toContainText("2本");
    await expect(summary("リリース点のばらつき")).toContainText("2 球以上で出します");

    const table = page.locator(".card", { has: page.getByRole("heading", { name: "投球ごとの指標" }) }).getByRole("table");
    await expect(table.getByRole("columnheader")).toHaveText(["指標", "#1", "平均", "幅", "標準偏差", "お手本ゾーン"]);
    await expect(table.getByRole("row", { name: /^ステップ幅/ })).toContainText(rep.metrics.strideRatio!.toFixed(2));

    // 追跡は済んでいて、投球をまだ解析していない映像（IMG_0001.MOV）
    const pending = page.locator(".card", { hasText: "比べられない映像があります" });
    await expect(pending).toContainText("投球をまだ解析していない映像が 1 本あります（IMG_0001.MOV）");
    const run = pending.getByRole("button", { name: "まとめて解析する" });
    await expect(run).toBeDisabled();
    await pending.getByRole("spinbutton", { name: "身長（cm）" }).fill("182");
    const sent = page.waitForRequest((r) => r.method() === "POST" && r.url() === `${ANALYZER_URL}/api/videos/${IDS.upload}/throws`);
    await run.click();
    expect((await sent).postDataJSON()).toEqual({ heightCm: 182, camera: "side" });

    await expect(pending).toBeHidden();
    await expect(summary("投球")).toContainText("2球");
    await expect(table.getByRole("columnheader")).toHaveText(["指標", "#1", "#2", "平均", "幅", "標準偏差", "お手本ゾーン"]);
    // 同じ投球が 2 本なので、ばらつきは 0
    await expect(summary("リリース点のばらつき")).toContainText("0.0cm");
    await expect(page.getByRole("img", { name: "リリース点の散布図" })).toBeVisible();
    // 開き直しても、解析した結果が残っている（解析サービスに保存した）
    await page.reload();
    await expect(summary("投球")).toContainText("2球");
    expect(analyzer.find("POST", `/api/videos/${IDS.upload}/throws`)).toHaveLength(1);
  });

  test("列の番号で投球を選び、「映像で見る」でその投球のリリースの瞬間を開く", async ({ page, analyzer }) => {
    // 2 本目の映像も解析済みにしておく
    analyzer.analyses.set(IDS.upload, structuredClone(samples.throws));
    const v = analyzer.videos.get(IDS.upload)!;
    analyzer.videos.set(IDS.upload, { ...v, links: { ...v.links, throws: `/api/videos/${IDS.upload}/throws` } });

    await open(page, PRACTICE);
    await page.getByRole("columnheader", { name: "#2" }).getByRole("button").click();
    const ghosts = page.locator(".card", { has: page.getByRole("heading", { name: "リリースの骨格を重ねる" }) });
    await expect(ghosts).toContainText("#2（IMG_0001.MOV の #1）を緑");

    await ghosts.getByRole("link", { name: "映像で見る" }).click();
    const t = (releaseFrame(rep) / fps).toFixed(2);
    await expect(page).toHaveURL(new RegExp(`#/footage/${IDS.upload}\\?t=${t}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("② 見る：自分の映像");
    // リリースの時刻で止め、その投球を選んでいる
    await expect(page.getByText(new RegExp(`^${t} / `))).toBeVisible();
    await expect(page.getByRole("radio", { name: new RegExp(`^#${rep.index}\\s*リリース ${t}s$`) })).toBeChecked();
    await expect(page.locator(".card", { has: page.getByRole("heading", { name: /^投球 \d+ 球$/ }) })).toContainText(formatMetric("strideRatio", rep.metrics.strideRatio));
  });

  test("お手本の骨格を重ねて動かし、練習を消すと一覧に戻る", async ({ page, analyzer }) => {
    await open(page, PRACTICE);
    const ghost = page.locator(".card", { has: page.getByRole("heading", { name: "お手本と重ねる" }) });
    await expect(ghost.getByRole("combobox", { name: "重ねるお手本" })).toContainText(samples.references[0]!.title as string);
    await ghost.getByRole("radio", { name: "並べる" }).click();
    await expect(ghost.getByRole("img", { name: "骨格オーバーレイ付きの投球映像" })).toHaveCount(2);

    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "練習を消す" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("自分の映像");
    expect(analyzer.find("DELETE", `/api/practices/${IDS.practice}`)).toHaveLength(1);
    await expect(page.getByRole("link", { name: /投球ドリル/ })).toHaveCount(0);
  });
});
