// 画面の主な操作の流れを、ブラウザを動かして確かめる（Playwright）。`npm run e2e` で動かす。
//
// 画面は、利用者が受け取るのと同じ本番用のビルドを vite preview で配信する。開発サーバーは開いた画面から順に
// 変換するので、最初に開く画面が遅く、待ち時間に左右されやすい。ビルドは 2 つ作る。
//   - demo：公開デモ（GitHub Pages）と同じ。解析サービスの URL を持たず、合成データだけで動く。リポジトリ名のサブパスで配信する
//   - local：手元の解析サービスにつなぐ設定（VITE_ANALYZER_URL）を入れたもの。解析サービスは動かさず、
//     テストの中で API の呼び出しを受け（route）、API の見本（packages/schema/fixtures/api-samples.v1.json）で応答する（e2e/support/analyzer.ts）
//     （手元では開発サーバーで使うが、.env.development の Ollama にはつながず、テストが手元の環境に左右されないようにする）
//
// ブラウザは、CI では Playwright の Chromium を、手元ではダウンロードせずに入っている Google Chrome を使う。

import { defineConfig, devices } from "@playwright/test";
import { ANALYZER_URL, DEMO_BASE, DEMO_PORT, DEMO_URL, LOCAL_PORT, LOCAL_URL } from "./e2e/support/env";

const CI = !!process.env.CI;

/** ビルドして配信する。ビルドは dist-e2e/ に分けて置き、npm run build の dist/ と混ぜない */
const serve = (name: string, port: number) =>
  `npx vite build --outDir dist-e2e/${name} --emptyOutDir --logLevel warn && npx vite preview --outDir dist-e2e/${name} --host 127.0.0.1 --port ${port} --strictPort`;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: CI,
  // 揺らぎを隠さないよう、失敗したテストをやり直さない
  retries: 0,
  reporter: CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    channel: CI ? undefined : "chrome",
    // GPU は使わない。手元の Google Chrome（macOS）でテストを並べて動かすと、GPU のプロセスが 30 秒ほど止まって
    // 描画（requestAnimationFrame）が進まず、最初のほうのテストが時間切れになることがあった。画面は WebGL を使わないので、描画は変わらない
    launchOptions: { args: ["--disable-gpu"] },
    viewport: { width: 1280, height: 900 },
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "demo", testIgnore: /local-.*\.spec\.ts/, use: { baseURL: DEMO_URL } },
    { name: "local", testMatch: /local-.*\.spec\.ts/, use: { baseURL: LOCAL_URL } },
  ],
  webServer: [
    {
      command: serve("demo", DEMO_PORT),
      url: DEMO_URL,
      // 手元の .env.local などに書いた URL があっても、公開デモと同じく、解析サービスと Ollama なしで作る
      env: { BASE_PATH: DEMO_BASE, VITE_ANALYZER_URL: "", VITE_OLLAMA_URL: "" },
      timeout: 120_000,
    },
    {
      command: serve("local", LOCAL_PORT),
      url: LOCAL_URL,
      env: { BASE_PATH: "/", VITE_ANALYZER_URL: ANALYZER_URL, VITE_OLLAMA_URL: "" },
      timeout: 120_000,
    },
  ],
});
