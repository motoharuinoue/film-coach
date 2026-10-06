// e2e テストの共通の準備。
//   - 画面のエラー（console.error・捕まえていない例外・失敗したリクエスト・400 番台以上の応答）を集め、テストの終わりに 1 つもないことを確かめる
//   - 外（YouTube など）へのリクエストは止めてエラーとして数える。要るものは、テストの中で偽の応答を返す
//   - 使い方ツアーは、ツアーのテストのほかは見た状態にしておく（初めてホームを開くと自動で始まるため）
// ページを作る前に、ブラウザのコンテキストに設定する（あとから開いたページにも効かせる）。

import { test as base, expect, type Page } from "@playwright/test";

export type Problems = {
  /** このテストで起きてよいエラー（止めた解析サービスへのリクエスト など） */
  allow: (pattern: RegExp) => void;
};

type Fixtures = {
  /** 使い方ツアーを見た状態で始めるか */
  tourSeen: boolean;
  problems: Problems;
};

/** 画面が自分で取り消したもの（表示が切り替わって読み込み途中の画像や動画をやめた、追跡が終わって進み具合の受信を閉じた）。失敗ではない */
const cancelled = (type: string, error: string) => error === "net::ERR_ABORTED" && ["image", "media", "eventsource"].includes(type);

export const test = base.extend<Fixtures>({
  tourSeen: [true, { option: true }],
  problems: [
    async ({ context, baseURL, tourSeen }, use) => {
      const app = new URL(baseURL!).origin;
      const found: string[] = [];
      const allowed: RegExp[] = [];
      context.on("console", (m) => {
        if (m.type() === "error") found.push(`console.error：${m.text()}（${m.location().url}）`);
      });
      context.on("weberror", (e) => found.push(`例外：${e.error().message}`));
      context.on("requestfailed", (r) => {
        const error = r.failure()?.errorText ?? "";
        if (!cancelled(r.resourceType(), error)) found.push(`失敗したリクエスト：${r.method()} ${r.url()}（${error}）`);
      });
      context.on("response", (r) => {
        if (r.status() >= 400) found.push(`エラーの応答：${r.status()} ${r.request().method()} ${r.url()}`);
      });
      await context.route(
        (url) => url.origin !== app,
        (route) => {
          found.push(`外へのリクエスト：${route.request().method()} ${route.request().url()}`);
          return route.abort("blockedbyclient");
        },
      );
      // 画面のページにだけ書く（最初の about:blank や埋め込みのページでは localStorage を使えない）
      if (tourSeen) await context.addInitScript((origin) => location.origin === origin && localStorage.setItem("film-coach:tour-seen", "true"), app);

      await use({ allow: (p) => allowed.push(p) });

      expect(
        found.filter((f) => !allowed.some((p) => p.test(f))),
        "画面でエラーが起きています",
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** ハッシュの経路（例：/progress）で画面を開く。GitHub Pages のサブパスでも動くよう、baseURL からの相対で開く */
export async function open(page: Page, path: string) {
  await page.goto(`#${path}`);
}

/** ページが画面の横幅からはみ出している幅（px）。0 なら横スクロールは出ない */
export async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}
