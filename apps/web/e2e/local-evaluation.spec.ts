// 精度の評価（手元の解析サービスにつなぐ設定。解析サービスは偽の応答で置き換える）：
// 保存した正解と誤差の結果を出し、コマ送りで瞬間を、クリックで関節を付け、少し待ってまとめて保存する。
// 閉じるときは、待っている保存を済ませてから、付けた正解で計算し直す。

import type { Page } from "@playwright/test";
import { cropFor, jointLabel, LABEL_JOINTS, type FrameLabel } from "../src/domain/evaluation";
import type { TrackBox } from "../src/domain/footage";
import { parseEvaluation, parseTrack } from "../src/infrastructure/http/httpFootageLibrary";
import { IDS, samples } from "./support/analyzer";
import { ANALYZER_URL } from "./support/env";
import { expect, open, test } from "./support/local";

const evaluation = parseEvaluation(samples.evaluation);
const target = evaluation.targets[0]!;
const video = target.video;
const t = target.throws[0]!;
const SAVE = `/api/videos/${IDS.throws}/annotation`;
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** 正解を付ける画面のフレームの画像と、その枠（クリックを受ける） */
const frameView = (page: Page) => {
  const img = page.locator('[data-tour="evaluation-annotator"] img[src*="/frame?i="]');
  return { img, box: img.locator("xpath=..") };
};

test.describe("精度の評価", () => {
  test("保存した正解の進み具合と、正解との誤差（関節・瞬間・指標）を出す", async ({ page }) => {
    await open(page, "/evaluation");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("精度の評価");
    const row = page.getByRole("row", { name: new RegExp(video.name.replace(".", "\\.")) });
    await expect(row).toContainText(`${video.fps.toFixed(0)} fps · ${video.width}×${video.height} · 右投げ`);
    await expect(row.getByLabel("済み")).toBeVisible();
    await expect(row).toContainText(`${t.frames.length} / ${t.frames.length} 枚`);

    const r = evaluation.report;
    const results = page.locator('[data-tour="evaluation-results"]');
    await expect(results).toContainText(`正解：映像 ${r.videos} 本、投球 ${r.throws} 球（接地とリリースを付けたもの）、関節を付けたフレーム ${r.frames} 枚`);
    const joints = results.getByRole("table").first();
    await expect(joints.getByRole("row", { name: /^モデルの出力/ }).getByRole("cell")).toHaveText([
      "モデルの出力",
      `${r.joints.raw!.mean.toFixed(1)} cm`,
      `${r.joints.raw!.median.toFixed(1)} cm`,
      `${r.joints.raw!.p90.toFixed(1)} cm`,
      ...r.joints.raw!.within.map(pct),
    ]);
    await expect(joints.getByRole("row", { name: /^指標に使う骨格（補正/ }).getByRole("cell").nth(1)).toHaveText(`${r.joints.final!.mean.toFixed(1)} cm`);
    // 瞬間：リリースは解析のほうが 1 コマ遅い
    const release = r.details.events.find((e) => e.event === "release")!;
    const events = results.locator("section", { hasText: "瞬間（正解のフレームとの差" }).getByRole("row", { name: /^リリース/ });
    await expect(events).toContainText(`${r.events.release!.mean.toFixed(0)} ms`);
    await expect(events).toContainText(`${release.frames > 0 ? "+" : ""}${release.frames} コマ`);
    // 指標：瞬間が半コマずれたときの変わり幅が大きく、判定に使わない値の数
    await expect(results.getByRole("row", { name: /^接地時の前膝角度/ })).toContainText("0 / 1");
    await expect(results.getByRole("row", { name: /^リリース点の高さ/ })).toContainText("1 / 1");
  });

  test("付け終わった投球を開くと、すべて付け終わったことを示し、関節を選んで付け直せる", async ({ page, analyzer }) => {
    await open(page, "/evaluation");
    await page.getByRole("row", { name: /IMG_0002/ }).getByRole("button", { name: "関節を付ける" }).click();
    const annotator = page.locator('[data-tour="evaluation-annotator"]');
    await expect(annotator.getByRole("radio", { name: "② 関節" })).toBeChecked();
    await expect(annotator).toContainText("この投球のフレームは、すべて付け終わりました。");
    await expect(annotator).toContainText(`${t.frames.length} / ${t.frames.length} 枚`);

    // 投げる腕の手首を選んで、付け直す
    await annotator.getByRole("button", { name: new RegExp(`^${jointLabel("rWrist", target.hand)}`) }).click();
    const { box } = frameView(page);
    await box.click({ position: { x: 20, y: 20 } });
    await expect.poll(() => analyzer.find("PUT", SAVE).length).toBe(1);
    const saved = analyzer.annotations.get(IDS.throws)!;
    const pointsAt = (a: typeof saved) => (a.frames.find((f) => f.frame === t.frames[0]) as unknown as FrameLabel).points;
    const before = pointsAt(samples.annotation);
    const after = pointsAt(saved);
    expect(after.rWrist).not.toEqual(before.rWrist);
    // ほかの関節と瞬間はそのまま
    expect({ ...after, rWrist: null }).toEqual({ ...before, rWrist: null });
    expect(saved.throws).toEqual(samples.annotation.throws);
  });

  test("まだ正解のない投球に、コマ送りで接地とリリースを、クリックで関節を付けて、少し待ってから保存する", async ({ page, analyzer }) => {
    analyzer.annotations.delete(IDS.throws);
    await open(page, "/evaluation");
    await expect(page.getByText("正解を付けると、ここに誤差が出ます。")).toBeVisible();
    const row = page.getByRole("row", { name: /IMG_0002/ });
    // 正解を付けるフレーム：投球の区間の 25・50・75%（接地とリリースは、付けたら足す）
    const base = t.frames.filter((f) => !samples.annotation.throws.some((l) => l.plant === f || l.release === f));
    await expect(row).toContainText("未");
    await expect(row).toContainText(`0 / ${base.length} 枚`);
    await row.getByRole("button", { name: "瞬間を付ける" }).click();

    // ① 瞬間：解析で見つけた瞬間に引っ張られないよう、区間の中ほどから始める
    const annotator = page.locator('[data-tour="evaluation-annotator"]');
    await expect(annotator).toContainText(`${video.name} · 投球 ${t.rep}`);
    await expect(annotator.getByRole("radio", { name: "① 瞬間" })).toBeChecked();
    const mid = Math.round((t.start + t.end) / 2);
    const label = annotator.getByText(/^フレーム \d+（/);
    const at = (f: number) => `フレーム ${f}（${(f / video.fps).toFixed(2)} 秒）`;
    await expect(label).toHaveText(at(mid));
    await expect(frameView(page).img).toHaveAttribute("src", `${ANALYZER_URL}/api/videos/${IDS.throws}/frame?i=${mid}&maxWidth=3840`);
    await expect(annotator.getByText("未設定")).toHaveCount(2);

    // ← → で 1 フレーム、Shift を押しながらで 5 フレーム
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("ArrowLeft");
    const plant = mid + 7;
    await expect(label).toHaveText(at(plant));
    await expect(frameView(page).img).toHaveAttribute("src", new RegExp(`frame\\?i=${plant}&`));

    // 押してから 0.4 秒待って保存する
    const clicked = Date.now();
    await annotator.getByRole("button", { name: "このフレームを接地にする" }).click();
    await expect(annotator.getByRole("button", { name: "このフレームにしました" })).toBeDisabled();
    await expect.poll(() => analyzer.find("PUT", SAVE).length).toBe(1);
    const first = analyzer.find("PUT", SAVE)[0]!;
    expect(first.at - clicked).toBeGreaterThanOrEqual(400);
    expect(first.body).toEqual({ throws: [{ rep: t.rep, plant, release: null }], frames: [] });

    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
    const release = plant + 4;
    await annotator.getByRole("button", { name: "このフレームをリリースにする" }).click();
    await expect.poll(() => analyzer.find("PUT", SAVE).length).toBe(2);
    expect(analyzer.find("PUT", SAVE)[1]!.body).toEqual({ throws: [{ rep: t.rep, plant, release }], frames: [] });
    // 付けた瞬間へ戻れる
    await annotator.getByRole("button", { name: `フレーム ${plant} へ` }).click();
    await expect(label).toHaveText(at(plant));

    // ② 関節：付けた接地とリリースのフレームも加わる
    await annotator.getByRole("radio", { name: "② 関節" }).click();
    const frames = [...base, plant, release].sort((a, b) => a - b);
    for (const f of frames) await expect(annotator.getByRole("button", { name: String(f), exact: true })).toBeVisible();
    await expect(annotator).toContainText(`0 / ${frames.length} 枚`);
    const firstFrame = frames[0]!;
    const { img, box } = frameView(page);
    await expect(img).toHaveAttribute("src", new RegExp(`frame\\?i=${firstFrame}&`));
    const next = annotator.getByText("次にクリックする関節").locator("xpath=following-sibling::div[1]");
    await expect(next).toHaveText(jointLabel("nose", target.hand));

    // 拡大して見せる範囲（人の枠の 1.4 倍）の、横 25%・縦 50% を押すと、元の映像のピクセルで付く
    const track = parseTrack(analyzer.tracks.get(IDS.throws)!);
    const boxes = new Map<number, TrackBox>(track.frames.filter((f) => f.box).map((f) => [f.i, f.box!]));
    const crop = cropFor(boxes, firstFrame, Math.max(0, t.start - 15), Math.min(video.frameCount - 1, t.end), video.width, video.height);
    const size = (await box.boundingBox())!;
    await box.click({ position: { x: size.width * 0.25, y: size.height * 0.5 } });
    await expect(next).toHaveText(jointLabel(LABEL_JOINTS[1], target.hand));
    // N で「見えない」、もう 1 つ付けてから Backspace で 1 つ戻る
    await page.keyboard.press("n");
    await expect(next).toHaveText(jointLabel(LABEL_JOINTS[2], target.hand));
    await box.click({ position: { x: size.width * 0.6, y: size.height * 0.4 } });
    await expect(next).toHaveText(jointLabel(LABEL_JOINTS[3], target.hand));
    await page.keyboard.press("Backspace");
    await expect(next).toHaveText(jointLabel(LABEL_JOINTS[2], target.hand));
    const list = (j: (typeof LABEL_JOINTS)[number]) => annotator.getByRole("button", { name: new RegExp(`^${jointLabel(j, target.hand).replace(/[()（）]/g, ".")}`) });
    await expect(list("nose")).toContainText("済");
    await expect(list("lShoulder")).toContainText("見えない");
    await expect(list("rShoulder")).toContainText("未");

    // 続けて付けた正解は、最後に付けてから 0.4 秒待ってまとめて保存する
    const savedFrames = () => (analyzer.annotations.get(IDS.throws)?.frames ?? []) as unknown as FrameLabel[];
    await expect.poll(() => savedFrames().map((f) => Object.keys(f.points))).toEqual([["nose", "lShoulder"]]);
    expect(analyzer.annotations.get(IDS.throws)!.throws).toEqual([{ rep: t.rep, plant, release }]);
    const { frame, points } = savedFrames()[0]!;
    expect(frame).toBe(firstFrame);
    expect(points.lShoulder).toBeNull();
    // 画面の 1px は、元の映像の crop.w / 枠の幅 px にあたる
    const px = crop.w / size.width;
    expect(Math.abs(points.nose![0] - (crop.x + crop.w * 0.25))).toBeLessThanOrEqual(px + 0.1);
    expect(Math.abs(points.nose![1] - (crop.y + crop.h * 0.5))).toBeLessThanOrEqual(px + 0.1);
  });

  test("閉じると、待っている保存を済ませてから、付けた正解で計算し直す", async ({ page, analyzer }) => {
    analyzer.annotations.delete(IDS.throws);
    analyzer.saveDelayMs = 300;
    await open(page, "/evaluation");
    await page.getByRole("row", { name: /IMG_0002/ }).getByRole("button", { name: "瞬間を付ける" }).click();
    const annotator = page.locator('[data-tour="evaluation-annotator"]');
    await annotator.getByRole("button", { name: "このフレームを接地にする" }).click();
    await annotator.getByRole("button", { name: "閉じる" }).click();

    // 保存（応答に 0.3 秒かかる）が終わってから、誤差を読み直す
    await expect.poll(() => analyzer.find("GET", "/api/evaluation").length).toBe(2);
    const put = analyzer.find("PUT", SAVE).at(-1)!;
    const reload = analyzer.find("GET", "/api/evaluation")[1]!;
    expect((put.body as { throws: unknown }).throws).toEqual([{ rep: t.rep, plant: Math.round((t.start + t.end) / 2), release: null }]);
    expect(reload.at - put.at).toBeGreaterThanOrEqual(300);
    // 保存した正解で計算し直した結果を出す
    const row = page.getByRole("row", { name: /IMG_0002/ });
    await expect(row).toContainText("未");
    await expect(page.locator('[data-tour="evaluation-results"]')).toContainText(`正解：映像 ${evaluation.report.videos} 本`);
  });

  test("保存の途中で閉じても、その保存が終わってから計算し直す", async ({ page, analyzer }) => {
    analyzer.annotations.delete(IDS.throws);
    const DELAY = 2000;
    analyzer.saveDelayMs = DELAY;
    await open(page, "/evaluation");
    await page.getByRole("row", { name: /IMG_0002/ }).getByRole("button", { name: "瞬間を付ける" }).click();
    const annotator = page.locator('[data-tour="evaluation-annotator"]');
    await annotator.getByRole("button", { name: "このフレームを接地にする" }).click();
    // 0.4 秒待って保存が始まり、応答を待っている（2 秒かかる）あいだに閉じる
    await expect.poll(() => analyzer.find("PUT", SAVE).length, { intervals: [50] }).toBe(1);
    await expect(annotator).toContainText("保存しています…");
    const closed = Date.now();
    await annotator.getByRole("button", { name: "閉じる" }).click();

    await expect.poll(() => analyzer.find("GET", "/api/evaluation").length, { timeout: DELAY + 5000 }).toBe(2);
    const put = analyzer.find("PUT", SAVE)[0]!;
    const reload = analyzer.find("GET", "/api/evaluation")[1]!;
    expect(closed - put.at, "保存の応答を待っているあいだに閉じた").toBeLessThan(DELAY);
    expect(reload.at - put.at).toBeGreaterThanOrEqual(DELAY);
    // 同じ正解を 2 回送らない
    expect(analyzer.find("PUT", SAVE)).toHaveLength(1);
    await expect(page.getByRole("row", { name: /IMG_0002/ })).toContainText("未");
    await expect(page.locator('[data-tour="evaluation-results"]')).toContainText(`正解：映像 ${evaluation.report.videos} 本`);
  });
});
