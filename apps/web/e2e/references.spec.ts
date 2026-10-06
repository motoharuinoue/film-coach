// お手本ライブラリ：重みの内訳、手動調整、分布と人気度だけの場合との比較、重み付けの検証（公開デモ）。

import { METRIC_BY_KEY } from "../src/domain/metrics";
import { SCHEME_LABEL, SCHEMES } from "../src/domain/weightValidation";
import { bench, coach, focus } from "./support/demo";
import { expect, open, test } from "./support/fixtures";

const refs = coach.references();

test.describe("お手本ライブラリ", () => {
  test("お手本を選ぶと、重みの内訳（P・C・Q・K・M と重み w）を出す", async ({ page }) => {
    await open(page, "/references");
    const detail = page.locator('[data-tour="references-detail"]');
    await expect(detail.getByRole("heading", { level: 2 }).first()).toHaveText(refs[0]!.title);

    const r = refs[1]!;
    await page.getByRole("button", { name: new RegExp(r.title.replace(/[()?+*[\]]/g, "\\$&")) }).click();
    await expect(detail.getByRole("heading", { level: 2 }).first()).toHaveText(r.title);
    await expect(detail).toContainText(r.channel);

    // 指標ごとの重みの内訳
    for (const key of ["strideRatio", "elbowHeight"] as const) {
      await detail.getByRole("button", { name: METRIC_BY_KEY[key].short, exact: true }).click();
      const parts = bench.weights.parts[r.id]![key]!;
      for (const f of ["P", "C", "Q", "K", "M"] as const) {
        await expect(detail.getByText(f, { exact: true }).locator("xpath=../following-sibling::div[2]")).toHaveText(parts[f].toFixed(2));
      }
      await expect(detail.getByText("重み w").locator("xpath=following-sibling::div[2]")).toHaveText(parts.w.toFixed(2));
    }
  });

  test("除外すると重みが 0 になり、ブラウザに覚え、元に戻せる", async ({ page }) => {
    await open(page, "/references");
    const r = refs[0]!;
    const card = page.getByRole("button", { name: new RegExp(r.title) });
    await expect(card).toContainText((bench.weights.overall[r.id] ?? 0).toFixed(2));
    await expect(page.getByRole("button", { name: "手動調整を元に戻す" })).toHaveCount(0);

    const exclude = page.locator('[data-tour="references-detail"]').getByRole("button", { name: "除外" });
    await exclude.click();
    await expect(exclude).toHaveAttribute("aria-pressed", "true");
    await expect(card).toContainText("0.00");
    await expect(page.getByRole("button", { name: "手動調整を元に戻す" })).toBeVisible();

    // 開き直しても除外したまま
    await expect.poll(() => page.evaluate(() => localStorage.getItem("film-coach:manual"))).toContain('"excluded":true');
    await page.reload();
    await expect(page.locator('[data-tour="references-detail"]').getByRole("button", { name: "除外" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: new RegExp(r.title) })).toContainText("0.00");

    // ほかの画面の判定にも使う（レポートの参照したお手本で、重みが 0）
    await open(page, `/sessions/${focus.session.id}/report`);
    await expect(page.getByRole("row", { name: new RegExp(r.channel) }).getByRole("cell").last()).toHaveText("0.00");
    await open(page, "/references");

    await page.getByRole("button", { name: "手動調整を元に戻す" }).click();
    await expect(page.locator('[data-tour="references-detail"]').getByRole("button", { name: "除外" })).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("button", { name: new RegExp(r.title) })).toContainText((bench.weights.overall[r.id] ?? 0).toFixed(2));
    await expect(page.getByRole("button", { name: "手動調整を元に戻す" })).toHaveCount(0);
  });

  test("検索語と種類で一覧を絞り込む", async ({ page }) => {
    await open(page, "/references");
    const list = page.locator("button.card");
    await expect(list).toHaveCount(refs.length);
    await page.getByRole("textbox", { name: "お手本を検索" }).fill(refs[2]!.channel);
    await expect(list).toHaveCount(refs.filter((r) => r.channel === refs[2]!.channel).length);
    await page.getByRole("textbox", { name: "お手本を検索" }).fill("どれにも当たらない言葉");
    await expect(page.getByText("条件に合うお手本はありません。")).toBeVisible();
    await page.getByRole("textbox", { name: "お手本を検索" }).fill("");

    await page.getByRole("radio", { name: "ドリル解説" }).click();
    await expect(list).toHaveCount(refs.filter((r) => r.kind === "drill").length);
    await page.getByRole("button", { name: "Creative Commons のみ" }).click();
    await expect(list).toHaveCount(refs.filter((r) => r.kind === "drill" && r.creativeCommons).length);
  });

  test("分布を、人気度だけで重み付けした場合と比べられる", async ({ page }) => {
    await open(page, "/references");
    const card = page.locator(".card", { has: page.getByRole("heading", { name: "お手本の分布" }) });
    const toggle = card.getByRole("button", { name: "人気度だけで重み付けした場合と比べる" });
    const zone = bench.zones.strideRatio!;
    await expect(card.getByText("お手本ゾーン（重み付き四分位）").locator("xpath=following-sibling::dd")).toHaveText(`${zone.p25.toFixed(2)}〜${zone.p75.toFixed(2)}`);
    await expect(card.getByText("人気度だけの場合")).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(card.getByText("人気度だけの場合").locator("xpath=following-sibling::dd")).toHaveText(/^\d+\.\d{2}〜\d+\.\d{2}$/);
    // 比べる範囲は、分布の上に破線の枠で重ねる
    await expect(card.getByRole("img", { name: "お手本の分布" }).locator("rect[stroke-dasharray]")).toHaveCount(1);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(card.getByText("人気度だけの場合")).toHaveCount(0);

    // 指標を変えると、その指標の分布とお手本ゾーンを出す
    const elbow = bench.zones.elbowHeight!;
    await card.getByRole("button", { name: METRIC_BY_KEY.elbowHeight.short, exact: true }).click();
    await expect(card.getByText("お手本ゾーン（重み付き四分位）").locator("xpath=following-sibling::dd")).toHaveText(`${elbow.p25.toFixed(0)}〜${elbow.p75.toFixed(0)} cm`);
  });

  test("重み付けの検証で、4 通りの重みの付け方を比べた表を出す", async ({ page }) => {
    await open(page, "/references");
    const card = page.locator('[data-tour="references-validation"]');
    await expect(card.getByRole("heading", { name: "重み付けの検証" })).toBeVisible();
    // 1,000 回の選び直しを計算し終えるまで待つ
    const rows = card.getByRole("table").first().locator("tbody tr");
    await expect(rows).toHaveCount(SCHEMES.length);
    expect(SCHEMES).toHaveLength(4);
    for (const [i, s] of SCHEMES.entries()) {
      const cells = rows.nth(i).getByRole("cell");
      await expect(cells.first()).toContainText(SCHEME_LABEL[s]);
      await expect(cells).toHaveCount(4);
      for (let c = 1; c < 4; c++) await expect(cells.nth(c)).toHaveText(/^\d+\.\d%$/);
    }
    await expect(rows.first()).toContainText("採用");
    await expect(card.getByText("計算しています…")).toHaveCount(0);

    // 指標ごとの内訳を開いて、表示する値を切り替える
    await card.getByText("指標ごとの内訳").click();
    const detail = card.getByRole("table").nth(1);
    await expect(detail).toBeVisible();
    const before = await detail.locator("tbody").innerText();
    await card.getByRole("radiogroup", { name: "表示する値" }).getByRole("radio").nth(1).click();
    await expect(detail.locator("tbody")).not.toHaveText(before);
  });
});
