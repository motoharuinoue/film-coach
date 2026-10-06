// 自分の映像（手元の解析サービスにつなぐ設定。解析サービスは偽の応答で置き換える）：
// 一覧、練習にまとめる、本人を選んで追跡する、骨格を重ねて見る・投球を解析し直す。

import { coverage } from "../src/domain/footage";
import { formatMetric, METRICS } from "../src/domain/metrics";
import { releaseFrame } from "../src/domain/throws";
import { parseThrows, parseTrack } from "../src/infrastructure/http/httpFootageLibrary";
import { IDS, samples } from "./support/analyzer";
import { ANALYZER_URL } from "./support/env";
import { expect, open, test } from "./support/local";

test.describe("自分の映像の一覧", () => {
  test("取り込んだ映像と練習を、追跡の状況とサムネイル付きで並べる", async ({ page, analyzer }) => {
    await open(page, "/footage");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("自分の映像");

    const practice = page.getByRole("link", { name: /投球ドリル/ });
    await expect(practice).toContainText("2026-10-05 · ドリル · 映像 2 本");
    await expect(practice).toHaveAttribute("href", `#/footage/practices/${IDS.practice}`);

    const cards = page.locator(`a[href^="#/footage/"]:not([href*="practices"])`);
    await expect(cards).toHaveCount(analyzer.videos.size);
    for (const v of analyzer.videos.values()) {
      const card = page.locator(`a[href="#/footage/${v.id}"]`);
      await expect(card).toContainText(v.name);
      await expect(card).toContainText("追跡済み");
      await expect(card).toContainText(`${v.info.width}×${v.info.height} · ${v.info.fps.toFixed(0)} fps`);
      // 手元の映像は解析サービスのフレーム、YouTube の映像は YouTube のサムネイル
      const thumb = card.locator("img");
      const yt = v.youtube as { videoId: string } | null;
      await expect(thumb).toHaveAttribute("src", yt ? `https://i.ytimg.com/vi/${yt.videoId}/hqdefault.jpg` : `${ANALYZER_URL}/api/videos/${v.id}/frame?t=${(v.info.duration * 0.3).toFixed(2)}`);
      // 一覧の画像は、画面に入ってから読む（loading="lazy"）
      await thumb.scrollIntoViewIfNeeded();
      await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    }
  });

  test("「取り込む」で動画を選ぶと、解析サービスに送り、本人を選ぶ画面を開く", async ({ page, analyzer }) => {
    await open(page, "/footage");
    await page.getByRole("link", { name: "取り込む", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("① 取り込む");
    await expect(page.getByText("手元の解析サービスにつながっています。")).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({ name: "IMG_0100.MOV", mimeType: "video/quicktime", buffer: Buffer.alloc(64 * 1024) });
    const uploaded = page.waitForRequest((r) => r.method() === "POST" && r.url() === `${ANALYZER_URL}/api/videos`);
    await page.getByRole("button", { name: "取り込んで本人を選ぶ" }).click();
    expect((await uploaded).headers()["content-type"]).toMatch(/^multipart\/form-data/);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("① 取り込む：本人を選ぶ");
    const created = [...analyzer.videos.values()].find((v) => v.name === "IMG_0100.MOV")!;
    await expect(page).toHaveURL(new RegExp(`#/footage/${created.id}/pick$`));
    await expect(page.getByRole("button", { name: "この人を追う" })).toBeDisabled();
  });

  test("映像を選んで練習にまとめると、選んだ順で練習を作り、練習の画面を開く", async ({ page, analyzer }) => {
    await open(page, "/footage");
    await page.getByRole("button", { name: "練習にまとめる" }).click();
    const bar = page.locator("form", { hasText: "本を選んでいます" });
    await expect(bar.getByRole("button", { name: "まとめる" })).toBeDisabled();

    const first = page.getByRole("checkbox", { name: "IMG_0002.MOV を選ぶ" });
    const second = page.getByRole("checkbox", { name: "IMG_0001.MOV を選ぶ" });
    await first.click();
    await second.click();
    await expect(first).toHaveText("1");
    await expect(second).toHaveText("2");
    await expect(bar).toContainText("2 本を選んでいます");
    // もう一度押すと外れ、選び直すと最後に並ぶ
    await first.click();
    await expect(first).toHaveAttribute("aria-checked", "false");
    await expect(second).toHaveText("1");
    await first.click();
    await expect(first).toHaveText("2");

    await bar.getByRole("textbox", { name: "練習の名前" }).fill("金曜の投球");
    await bar.getByLabel("日付").fill("2026-10-09");
    const created = page.waitForRequest((r) => r.method() === "POST" && r.url() === `${ANALYZER_URL}/api/practices`);
    await bar.getByRole("button", { name: "まとめる" }).click();
    expect((await created).postDataJSON()).toEqual({ name: "金曜の投球", date: "2026-10-09", kind: "drill", camera: "side", memo: "", videoIds: [IDS.upload, IDS.throws] });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("練習：金曜の投球");
    await expect(page).toHaveURL(/#\/footage\/practices\/\d{12}$/);
    expect(analyzer.practices.size).toBe(2);
  });

  test("本人を押して「この人を追う」と、追跡の進み具合を受け取って、追跡した映像を開く", async ({ page, analyzer }) => {
    analyzer.untrack(IDS.upload);
    await open(page, `/footage/${IDS.upload}/pick`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("① 取り込む：本人を選ぶ");
    const v = analyzer.videos.get(IDS.upload)!;
    const t = Math.min(5, v.info.duration / 2);
    const frame = page.getByRole("img", { name: `${t.toFixed(1)} 秒のフレーム` });
    await expect(frame).toHaveAttribute("src", `${ANALYZER_URL}/api/videos/${IDS.upload}/frame?t=${t.toFixed(2)}`);
    const start = page.getByRole("button", { name: "この人を追う" });
    await expect(start).toBeDisabled();

    // 映像の横 25%・縦 50% の位置を押す（元の映像のピクセルで送る。押す位置は画面の 1px 単位なので、数 px ずれてよい）
    const box = (await frame.boundingBox())!;
    await frame.click({ position: { x: box.width * 0.25, y: box.height * 0.5 } });
    const picked = page.getByText(new RegExp(`^${t.toFixed(1)} 秒の \\(\\d+, \\d+\\)$`));
    await expect(picked).toBeVisible();
    const [x, y] = (await picked.innerText()).match(/\((\d+), (\d+)\)/)!.slice(1).map(Number);
    expect(x).toBeCloseTo(v.info.width * 0.25, -1);
    expect(y).toBeCloseTo(v.info.height * 0.5, -1);
    await page.getByRole("textbox", { name: "名前（枠に表示）" }).fill("#7");

    const tracked = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith(`/api/videos/${IDS.upload}/track`));
    await start.click();
    const body = (await tracked).postDataJSON() as { t: number; x: number; y: number; label: string };
    expect(body.label).toBe("#7");
    expect(body.t).toBeCloseTo(t, 5);
    expect(body.x).toBeCloseTo(v.info.width * 0.25, -1);
    expect(body.y).toBeCloseTo(v.info.height * 0.5, -1);

    // 追跡が終わると、見る画面へ移る
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("② 見る：自分の映像");
    await expect(page).toHaveURL(new RegExp(`#/footage/${IDS.upload}$`));
    await expect(page.locator("aside", { hasText: "追跡の結果" })).toContainText("#7");
    expect(analyzer.find("GET", `/api/jobs/job-${IDS.upload}/events`)).toHaveLength(1);
  });
});

test.describe("骨格を重ねて見る（投球を解析した映像）", () => {
  const VIEW = `/footage/${IDS.throws}`;

  test("追跡の結果と、投球ごとのフェーズ・QB 指標を出す", async ({ page, analyzer }) => {
    await open(page, VIEW);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("② 見る：自分の映像");
    const track = parseTrack(analyzer.tracks.get(IDS.throws)!);
    const cov = coverage(track);
    const summary = page.locator(".card", { has: page.getByRole("heading", { name: "追跡の結果" }) });
    await expect(summary).toContainText(`本人が映っていた割合${Math.round(cov.ratio * 100)}%`);
    await expect(summary).toContainText(`補間したフレーム${cov.filled}`);
    await expect(summary).toContainText(`つないだ追跡${track.segments.length} 本`);
    await expect(summary).toContainText(`映像全体で追跡した人数${track.peopleTracked}`);

    const a = parseThrows(samples.throws);
    const rep = a.reps[0]!;
    const fps = analyzer.videos.get(IDS.throws)!.info.fps;
    const panel = page.locator(".card", { has: page.getByRole("heading", { name: `投球 ${a.reps.length} 球` }) });
    await expect(panel).toContainText("右投げ");
    await expect(panel.getByRole("radio", { name: new RegExp(`^#${rep.index}\\s*リリース ${(releaseFrame(rep) / fps).toFixed(2)}s$`) })).toBeChecked();
    await expect(panel).toContainText("ステップの前に骨盤が 1.4 m 下がっています（骨格から見分けました）");
    for (const d of METRICS.filter((m) => rep.metrics[m.key] !== undefined)) {
      await expect(panel.locator(".rounded-xl", { hasText: d.label })).toContainText(formatMetric(d.key, rep.metrics[d.key]));
    }
    // 手元のお手本（1 本）があるので、お手本と重ねて比べられる
    await expect(page.getByRole("heading", { name: "お手本と重ねる" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "重ねるお手本" })).toContainText(samples.references[0]!.title as string);
  });

  test("投球を選ぶとリリースの瞬間へ移り、身長と条件を変えて計算し直せる", async ({ page, analyzer }) => {
    await open(page, VIEW);
    const a = parseThrows(samples.throws);
    const rep = a.reps[0]!;
    const v = analyzer.videos.get(IDS.throws)!;
    await page.getByRole("radio", { name: new RegExp(`^#${rep.index}\\s*リリース`) }).click();
    await expect(page.getByText(`${(releaseFrame(rep) / v.info.fps).toFixed(2)} / ${v.info.duration.toFixed(1)}s`)).toBeVisible();
    // 再生できない映像（偽の解析サービスは動画の中身を返さない）では、その旨を出し、再生を押してもエラーにしない
    await expect(page.getByText("この映像は、このブラウザでは再生できません")).toBeVisible();
    await page.getByRole("button", { name: "再生" }).click();
    await expect(page.getByRole("button", { name: "再生" })).toBeVisible();

    await page.getByRole("button", { name: "変えて計算し直す" }).click();
    await page.getByRole("spinbutton", { name: "身長（cm）" }).fill("175");
    await page.getByRole("radiogroup", { name: "スロー再生の倍率" }).getByRole("radio", { name: "2 倍" }).click();
    await page.getByRole("radiogroup", { name: "投げ始め" }).getByRole("radio", { name: "その場から" }).click();
    const sent = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith(`/api/videos/${IDS.throws}/throws`));
    await page.getByRole("button", { name: "計算し直す" }).click();
    expect((await sent).postDataJSON()).toEqual({ heightCm: 175, camera: "side", slowmo: 2, approach: "standing" });
    await expect(page.getByText("身長 175 cm・横から・2 倍のスロー再生で計算しました")).toBeVisible();
    // 自分の映像なので、身長をこの端末に覚える
    expect(await page.evaluate(() => localStorage.getItem("film-coach:height-cm"))).toBe("175");
  });
});
