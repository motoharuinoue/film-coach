// 分析スタジオ：再生とコマ送り、フェーズの帯、指標カード、レップの切り替え、比較の表示（公開デモ）。

import { METRIC_BY_KEY } from "../src/domain/metrics";
import { PHASE_LABEL } from "../src/domain/phases";
import { bench, coach, focus } from "./support/demo";
import { expect, open, test } from "./support/fixtures";

const { session, rep } = focus;
const STUDIO = `/sessions/${session.id}/studio`;

test.describe("分析スタジオ", () => {
  test("ボタンとキーで、再生・一時停止・コマ送りができる", async ({ page }) => {
    await open(page, STUDIO);
    const slider = page.getByRole("slider", { name: "再生位置" });
    const start = rep.events.strideStart;
    // ステップの始まりから見せる
    await expect(slider).toHaveValue(String(start));
    await expect(page.getByRole("img", { name: "骨格オーバーレイ付きの投球映像" })).toContainText(`FRAME ${String(start).padStart(3, "0")}`);

    await page.getByRole("button", { name: "1 フレーム進む" }).click();
    await page.getByRole("button", { name: "1 フレーム進む" }).click();
    await expect(slider).toHaveValue(String(start + 2));
    await page.getByRole("button", { name: "1 フレーム戻る" }).click();
    await expect(slider).toHaveValue(String(start + 1));

    await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveValue(String(start + 2));
    await page.keyboard.press("Shift+ArrowRight");
    await expect(slider).toHaveValue(String(start + 12));
    await page.keyboard.press("ArrowLeft");
    await expect(slider).toHaveValue(String(start + 11));

    // Space で再生する。直前に押したボタンにフォーカスがあっても、そのボタンは押されない
    await page.keyboard.press(" ");
    await expect(page.getByRole("button", { name: "一時停止" })).toBeVisible();
    await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(start + 13);
    await page.keyboard.press(" ");
    await expect(page.getByRole("button", { name: "再生" })).toBeVisible();
    const stopped = await slider.inputValue();
    await page.waitForTimeout(300);
    await expect(slider).toHaveValue(stopped);

    // 再生ボタンと速さ
    await page.getByRole("radio", { name: "1×" }).click();
    await expect(page.getByRole("img", { name: "骨格オーバーレイ付きの投球映像" })).toContainText("1×");
    await page.getByRole("button", { name: "再生" }).click();
    await expect.poll(async () => Number(await slider.inputValue())).not.toBe(Number(stopped));
    await page.getByRole("button", { name: "一時停止" }).click();
    await expect(page.getByRole("button", { name: "再生" })).toBeVisible();
  });

  test("フェーズの帯を押すと、そのフェーズの始まりへ移る", async ({ page }) => {
    await open(page, STUDIO);
    const slider = page.getByRole("slider", { name: "再生位置" });
    const video = page.getByRole("img", { name: "骨格オーバーレイ付きの投球映像" });
    for (const phase of rep.phases) {
      await page.getByRole("button", { name: `${PHASE_LABEL[phase.key]}へ移動` }).click();
      await expect(slider).toHaveValue(String(phase.start));
      await expect(video).toContainText(PHASE_LABEL[phase.key]);
    }
  });

  test("指標カードを押すと、その判定の根拠のフレームへ移る", async ({ page }) => {
    await open(page, STUDIO);
    const slider = page.getByRole("slider", { name: "再生位置" });
    const cards = page.locator('[data-tour="studio-metrics"]').getByRole("button");
    const rows = coach.evaluate(rep, session.camera, bench);
    await expect(cards).toHaveCount(rows.length);
    for (const r of rows) {
      const def = METRIC_BY_KEY[r.key];
      const card = cards.filter({ hasText: def.label });
      if (r.status === "na") {
        await expect(card).toBeDisabled();
        continue;
      }
      // 前のカードと同じフレームだと動いたか分からないので、いったん先頭へ戻す
      await page.getByRole("button", { name: "ドロップへ移動" }).click();
      await card.click();
      await expect(slider, def.label).toHaveValue(String(def.at === "range" ? rep.events.setStart : rep.events[def.at]));
    }
    // AI コーチの一言の「根拠のフレームへ」
    const top = coach.findings(rep, session.camera, bench)[0]!;
    await page.getByRole("button", { name: "根拠のフレームへ" }).click();
    await expect(slider).toHaveValue(String(top.frame));
  });

  test("レップを切り替えると、そのレップのステップの始まりから見せる", async ({ page }) => {
    const top = coach.findings(rep, session.camera, bench)[0]!;
    await open(page, `${STUDIO}?rep=${rep.index + 1}&frame=${top.frame}`);
    const slider = page.getByRole("slider", { name: "再生位置" });
    await expect(slider).toHaveValue(String(top.frame));

    await page.getByRole("button", { name: "次のレップ" }).click();
    const next = session.reps[rep.index + 1]!;
    await expect(page.getByText(`Rep ${String(rep.index + 2).padStart(2, "0")} / ${session.reps.length}`)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`\\?rep=${rep.index + 2}$`));
    await expect(slider).toHaveValue(String(next.events.strideStart));

    await open(page, `${STUDIO}?rep=1`);
    await expect(page.getByRole("button", { name: "前のレップ" })).toBeDisabled();
    await open(page, `${STUDIO}?rep=${session.reps.length}`);
    await expect(page.getByRole("button", { name: "次のレップ" })).toBeDisabled();
  });

  test("比較に切り替えると、自己ベストやお手本と重ねて・並べて比べられる", async ({ page }) => {
    await open(page, STUDIO);
    await page.getByRole("radio", { name: "比較" }).click();
    await expect(page).toHaveURL(/view=compare/);
    await expect(page.getByRole("heading", { name: "指標の差" })).toBeVisible();
    const scenes = page.getByRole("img", { name: "骨格オーバーレイ付きの投球映像" });
    await expect(scenes).toHaveCount(1);
    await expect(scenes).toContainText(`比較：自己ベスト`);

    await page.getByRole("radio", { name: "並べる" }).click();
    await expect(scenes).toHaveCount(2);

    const ref = coach.references().find((r) => r.stats.camera === "side")!;
    await page.getByRole("combobox", { name: "比べる相手" }).selectOption(ref.id);
    await expect(scenes.nth(1)).toContainText(ref.channel);

    // 旧 URL（/compare）はスタジオの比較表示へ送る
    await open(page, `/sessions/${session.id}/compare`);
    await expect(page).toHaveURL(new RegExp(`#/sessions/${session.id}/studio\\?view=compare$`));
    await expect(page.getByRole("radio", { name: "比較" })).toBeChecked();
  });

  test("骨格・角度・手首の軌跡の表示を切り替えられる", async ({ page }) => {
    await open(page, STUDIO);
    for (const name of ["骨格", "角度", "手首の軌跡"]) {
      const toggle = page.getByRole("button", { name, exact: true });
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
    }
    await page.getByRole("combobox", { name: "ゴースト" }).selectOption("none");
    await expect(page.getByRole("img", { name: "骨格オーバーレイ付きの投球映像" })).not.toContainText("GHOST");
  });
});
