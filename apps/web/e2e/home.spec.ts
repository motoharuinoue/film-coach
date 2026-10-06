// ホーム：最新のスコア、次に直すこと、最近のセッション、サイドバーの使う流れ（公開デモ）。

import { formatDate } from "../src/presentation/state/session";
import { bench, coach, focus, player } from "./support/demo";
import { expect, open, test } from "./support/fixtures";

const { session, rep } = focus;
const top = coach.findings(rep, session.camera, bench)[0]!;

test.describe("ホーム", () => {
  test("最新のスコアと次に直すことを、判定の計算と同じ値で出す", async ({ page }) => {
    await open(page, "/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`おかえり、${player.name!.split(" ")[1]}`);

    const score = page.locator('[data-tour="home-score"]');
    await expect(score).toContainText(`${formatDate(session.date)} · ${session.title}`);
    await expect(score).toContainText(new RegExp(`${coach.sessionScore(session, bench)}\\s*/ 100`));
    await expect(score).toContainText(`${coach.sessions().filter((s) => coach.sessionScore(s, bench) !== undefined).length} セッション`);

    const next = page.locator('[data-tour="home-next"]');
    await expect(next.getByRole("heading", { name: top.title })).toBeVisible();
    await expect(next).toContainText(top.body);
    await expect(next).toContainText(`目標：${top.target}`);
    await expect(next).toContainText(`${top.drill!.label}`);
    await expect(next).toContainText(`Rep ${String(rep.index + 1).padStart(2, "0")} · ${(top.frame / rep.seq.fps).toFixed(2)}s`);
  });

  test("次に直すことの画像から、分析スタジオでその根拠の場面を開く", async ({ page }) => {
    await open(page, "/");
    await page.getByRole("link", { name: "根拠のフレームを分析スタジオで見る" }).click();
    await expect(page.getByRole("heading", { name: "分析スタジオ" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`#/sessions/${session.id}/studio\\?rep=${rep.index + 1}&frame=${top.frame}$`));
    await expect(page.getByText(`Rep ${String(rep.index + 1).padStart(2, "0")} / ${session.reps.length}`)).toBeVisible();
    // 画像に出していた時刻（根拠のフレーム）で止まっている
    await expect(page.getByRole("slider", { name: "再生位置" })).toHaveValue(String(top.frame));
    await expect(page.getByRole("button", { name: "再生" })).toBeVisible();
  });

  test("レポートと推移へのリンク、最近のセッションからレップ一覧へ進める", async ({ page }) => {
    await open(page, "/");
    await page.getByRole("link", { name: "レポートを見る" }).click();
    await expect(page).toHaveURL(new RegExp(`#/sessions/${session.id}/report$`));
    await expect(page.getByRole("heading", { name: `改善点トップ ${coach.findings(rep, session.camera, bench).length}` })).toBeVisible();

    await open(page, "/");
    const recent = page.locator("a[href^='#/sessions/'][href$='/reps']");
    await expect(recent).toHaveCount(coach.sessions().length);
    // 新しい順に並ぶ
    const oldest = coach.sessions()[0]!;
    await recent.last().click();
    await expect(page).toHaveURL(new RegExp(`#/sessions/${oldest.id}/reps$`));
    await expect(page.getByRole("heading", { name: "① 取り込む：レップを選ぶ" })).toBeVisible();
    await expect(page.getByText(`${oldest.reps.length} レップを自動で切り出しました`)).toBeVisible();

    await open(page, "/");
    await page.getByRole("link", { name: "推移を見る" }).click();
    await expect(page.getByRole("heading", { name: "④ 続ける：推移" })).toBeVisible();
  });

  test("サイドバーの使う流れから、表示中のセッションの各画面へ移る", async ({ page }) => {
    await open(page, "/");
    const nav = page.getByRole("navigation", { name: "メイン" });
    const steps = [
      { name: "取り込む", url: "#/sessions/new", heading: "① 取り込む" },
      { name: "見る", url: `#/sessions/${session.id}/studio`, heading: "分析スタジオ" },
      { name: "直す", url: `#/sessions/${session.id}/report`, heading: `改善点トップ ${coach.findings(rep, session.camera, bench).length}` },
      { name: "続ける", url: "#/progress", heading: "④ 続ける：推移" },
    ];
    for (const s of steps) {
      await nav.getByRole("link", { name: new RegExp(`^\\d ${s.name}`) }).click();
      await expect(page).toHaveURL(new RegExp(`${s.url.replace(/[?]/g, "\\?")}$`));
      await expect(page.getByRole("heading", { name: s.heading })).toBeVisible();
    }
    await nav.getByRole("link", { name: "ホーム" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^おかえり/);
  });
});
